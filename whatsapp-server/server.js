import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import makeWASocket, { 
  DisconnectReason, 
  useMultiFileAuthState,
  Browsers,
  makeInMemoryStore
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import { createClient } from '@supabase/supabase-js';
import pino from 'pino';
import QRCode from 'qrcode';

const app = express();
const server = createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

// Middleware
app.use(cors());
app.use(express.json());

// Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// Logger
const logger = pino({ level: 'info' });

// Store active WhatsApp sessions
const activeSessions = new Map();

// In-memory store for message sync
const messageStore = makeInMemoryStore({ logger });

// Helper: Get or create session
async function getOrCreateSession(clientId, sessionName = 'default') {
  const sessionKey = `${clientId}-${sessionName}`;
  
  if (activeSessions.has(sessionKey)) {
    return activeSessions.get(sessionKey);
  }
  
  return null;
}

// Helper: Initialize WhatsApp connection
async function initializeWhatsApp(clientId, sessionName = 'default') {
  const sessionKey = `${clientId}-${sessionName}`;
  
  logger.info({ sessionKey }, 'Initializing WhatsApp session');
  
  // Auth state stored in /data for persistence
  const authPath = `/data/auth_${sessionKey}`;
  const { state, saveCreds } = await useMultiFileAuthState(authPath);
  
  let qrCode = null;
  let status = 'connecting';
  
  const sock = makeWASocket({
    auth: state,
    printQRInTerminal: false,
    browser: Browsers.ubuntu('Chrome'),
    logger: pino({ level: 'silent' }),
    syncFullHistory: false,
    generateHighQualityLinkPreview: true
  });
  
  // Bind message store
  messageStore.bind(sock.ev);
  
  // Handle connection updates
  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;
    
    if (qr) {
      logger.info({ sessionKey }, 'QR Code generated');
      
      // Generate base64 QR code
      qrCode = await QRCode.toDataURL(qr);
      status = 'qr_ready';
      
      // Update Supabase
      await supabase
        .from('whatsapp_sessions')
        .upsert({
          client_id: clientId,
          session_name: sessionName,
          status: 'qr_ready',
          qr_code: qrCode,
          last_activity: new Date().toISOString()
        }, {
          onConflict: 'client_id,session_name'
        });
      
      // Emit QR to connected clients
      io.to(sessionKey).emit('qr-code', { qrCode, sessionKey });
    }
    
    if (connection === 'close') {
      const shouldReconnect = (lastDisconnect?.error)?.output?.statusCode !== DisconnectReason.loggedOut;
      logger.warn({ sessionKey, shouldReconnect }, 'Connection closed');
      
      if (!shouldReconnect) {
        activeSessions.delete(sessionKey);
        status = 'disconnected';
        
        await supabase
          .from('whatsapp_sessions')
          .update({ 
            status: 'disconnected',
            qr_code: null 
          })
          .eq('client_id', clientId)
          .eq('session_name', sessionName);
        
        io.to(sessionKey).emit('disconnected', { sessionKey });
      } else {
        // Reconnect
        setTimeout(() => initializeWhatsApp(clientId, sessionName), 3000);
      }
    } else if (connection === 'open') {
      logger.info({ sessionKey, phoneNumber: sock.user?.id }, 'WhatsApp connected');
      status = 'connected';
      
      await supabase
        .from('whatsapp_sessions')
        .upsert({
          client_id: clientId,
          session_name: sessionName,
          status: 'connected',
          phone_number: sock.user?.id || '',
          qr_code: null,
          last_activity: new Date().toISOString()
        }, {
          onConflict: 'client_id,session_name'
        });
      
      io.to(sessionKey).emit('connected', { 
        sessionKey, 
        phoneNumber: sock.user?.id 
      });
    }
  });
  
  // Save credentials on update
  sock.ev.on('creds.update', saveCreds);
  
  // Handle incoming messages
  sock.ev.on('messages.upsert', async (m) => {
    const msg = m.messages[0];
    if (!msg.message || msg.key.fromMe) return;
    
    logger.info({ from: msg.key.remoteJid }, 'Incoming message');
    
    // Get session from DB
    const { data: session } = await supabase
      .from('whatsapp_sessions')
      .select('id')
      .eq('client_id', clientId)
      .eq('session_name', sessionName)
      .single();
    
    if (session) {
      const content = msg.message.conversation || 
                     msg.message.extendedTextMessage?.text || 
                     '';
      
      // Save to database
      const { data: savedMessage } = await supabase
        .from('whatsapp_messages')
        .insert({
          session_id: session.id,
          message_id: msg.key.id || '',
          chat_id: msg.key.remoteJid || '',
          from_number: msg.key.remoteJid || '',
          to_number: sock.user?.id || '',
          message_type: 'text',
          content: content,
          is_outgoing: false,
          timestamp: new Date().toISOString(),
          status: 'received'
        })
        .select()
        .single();
      
      // Emit to connected clients
      io.to(sessionKey).emit('message', savedMessage);
    }
  });
  
  // Store session
  const sessionData = {
    sock,
    status,
    qrCode,
    createdAt: Date.now()
  };
  
  activeSessions.set(sessionKey, sessionData);
  
  return sessionData;
}

// API Routes
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    activeSessions: activeSessions.size,
    uptime: process.uptime()
  });
});

// Start WhatsApp session
app.post('/api/whatsapp/start', async (req, res) => {
  try {
    const { clientId, sessionName = 'default' } = req.body;
    
    if (!clientId) {
      return res.status(400).json({ error: 'clientId is required' });
    }
    
    const sessionKey = `${clientId}-${sessionName}`;
    
    // Check if already exists
    let session = activeSessions.get(sessionKey);
    
    if (session?.sock?.user) {
      return res.json({ 
        status: 'connected',
        phoneNumber: session.sock.user.id,
        message: 'Session already connected'
      });
    }
    
    // Initialize new session
    session = await initializeWhatsApp(clientId, sessionName);
    
    // Wait for QR code
    let attempts = 0;
    while (attempts < 20 && !session.qrCode && session.status !== 'connected') {
      await new Promise(resolve => setTimeout(resolve, 500));
      attempts++;
    }
    
    res.json({
      status: session.status,
      qrCode: session.qrCode,
      phoneNumber: session.sock?.user?.id
    });
    
  } catch (error) {
    logger.error({ error }, 'Error starting session');
    res.status(500).json({ error: error.message });
  }
});

// Get session status
app.get('/api/whatsapp/status/:clientId', async (req, res) => {
  try {
    const { clientId } = req.params;
    const { sessionName = 'default' } = req.query;
    
    const sessionKey = `${clientId}-${sessionName}`;
    const session = activeSessions.get(sessionKey);
    
    if (!session) {
      return res.json({ status: 'disconnected' });
    }
    
    res.json({
      status: session.status,
      phoneNumber: session.sock?.user?.id,
      qrCode: session.status === 'qr_ready' ? session.qrCode : null
    });
    
  } catch (error) {
    logger.error({ error }, 'Error getting status');
    res.status(500).json({ error: error.message });
  }
});

// Send message
app.post('/api/whatsapp/send', async (req, res) => {
  try {
    const { clientId, sessionName = 'default', to, message, leadId } = req.body;
    
    if (!clientId || !to || !message) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    
    const sessionKey = `${clientId}-${sessionName}`;
    const session = activeSessions.get(sessionKey);
    
    if (!session?.sock?.user) {
      return res.status(400).json({ error: 'Session not connected' });
    }
    
    // Format phone number
    let formattedNumber = to.replace(/\D/g, '');
    if (!formattedNumber.startsWith('972')) {
      formattedNumber = '972' + formattedNumber.replace(/^0/, '');
    }
    formattedNumber = `${formattedNumber}@s.whatsapp.net`;
    
    logger.info({ to: formattedNumber }, 'Sending message');
    
    // Send via Baileys
    const sentMsg = await session.sock.sendMessage(formattedNumber, { text: message });
    
    // Get session from DB
    const { data: dbSession } = await supabase
      .from('whatsapp_sessions')
      .select('id')
      .eq('client_id', clientId)
      .eq('session_name', sessionName)
      .single();
    
    if (dbSession) {
      // Save to database
      await supabase
        .from('whatsapp_messages')
        .insert({
          session_id: dbSession.id,
          lead_id: leadId || null,
          message_id: sentMsg.key.id || '',
          chat_id: formattedNumber,
          from_number: session.sock.user.id,
          to_number: formattedNumber,
          message_type: 'text',
          content: message,
          is_outgoing: true,
          timestamp: new Date().toISOString(),
          status: 'sent'
        });
    }
    
    res.json({ 
      success: true,
      messageId: sentMsg.key.id 
    });
    
  } catch (error) {
    logger.error({ error }, 'Error sending message');
    res.status(500).json({ error: error.message });
  }
});

// Disconnect session
app.post('/api/whatsapp/disconnect', async (req, res) => {
  try {
    const { clientId, sessionName = 'default' } = req.body;
    
    if (!clientId) {
      return res.status(400).json({ error: 'clientId is required' });
    }
    
    const sessionKey = `${clientId}-${sessionName}`;
    const session = activeSessions.get(sessionKey);
    
    if (session?.sock) {
      await session.sock.logout();
      activeSessions.delete(sessionKey);
      
      await supabase
        .from('whatsapp_sessions')
        .update({ 
          status: 'disconnected',
          qr_code: null 
        })
        .eq('client_id', clientId)
        .eq('session_name', sessionName);
    }
    
    res.json({ success: true });
    
  } catch (error) {
    logger.error({ error }, 'Error disconnecting');
    res.status(500).json({ error: error.message });
  }
});

// Get messages
app.get('/api/whatsapp/messages/:clientId', async (req, res) => {
  try {
    const { clientId } = req.params;
    const { leadId, limit = 50 } = req.query;
    
    let query = supabase
      .from('whatsapp_messages')
      .select(`
        *,
        session:whatsapp_sessions!inner(client_id)
      `)
      .eq('session.client_id', clientId)
      .order('timestamp', { ascending: false })
      .limit(parseInt(limit));
    
    if (leadId) {
      query = query.eq('lead_id', leadId);
    }
    
    const { data: messages } = await query;
    
    res.json({ messages: messages || [] });
    
  } catch (error) {
    logger.error({ error }, 'Error fetching messages');
    res.status(500).json({ error: error.message });
  }
});

// Socket.IO connection
io.on('connection', (socket) => {
  logger.info({ socketId: socket.id }, 'Client connected');
  
  socket.on('subscribe', (sessionKey) => {
    socket.join(sessionKey);
    logger.info({ socketId: socket.id, sessionKey }, 'Client subscribed to session');
  });
  
  socket.on('unsubscribe', (sessionKey) => {
    socket.leave(sessionKey);
    logger.info({ socketId: socket.id, sessionKey }, 'Client unsubscribed from session');
  });
  
  socket.on('disconnect', () => {
    logger.info({ socketId: socket.id }, 'Client disconnected');
  });
});

// Start server
const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  logger.info({ port: PORT }, 'WhatsApp Baileys server started');
});
