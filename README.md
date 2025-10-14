# WhatsApp Baileys Server

שרת Node.js עם Express ו-Baileys לניהול חיבורי WhatsApp עבור מערכת ה-CRM.

## פריסה על Render

### שלב 1: העלאת הקוד
1. העתק את התיקייה `whatsapp-server` לריפו של הפרויקט
2. Commit ו-Push ל-GitHub/GitLab

### שלב 2: יצירת Web Service
1. היכנס ל-[Render Dashboard](https://dashboard.render.com/)
2. לחץ על "New" -> "Web Service"
3. חבר את הריפו שלך
4. הגדרות:
   - **Name**: `whatsapp-baileys-server`
   - **Runtime**: Node
   - **Build Command**: `cd whatsapp-server && npm install`
   - **Start Command**: `cd whatsapp-server && npm start`
   - **Plan**: Starter ($7/month) או Free (עם cold starts)

### שלב 3: Environment Variables
הוסף את משתני הסביבה הבאים:
- `SUPABASE_URL`: https://jglhwwubdywvboryuype.supabase.co
- `SUPABASE_SERVICE_KEY`: [מפתח ה-Service Role מSupabase]
- `PORT`: 3001 (אוטומטי)

### שלב 4: Persistent Disk
1. לחץ על "Disks" בתפריט צד
2. הוסף דיסק חדש:
   - **Name**: whatsapp-auth-data
   - **Mount Path**: `/data`
   - **Size**: 1GB

### שלב 5: Deploy
לחץ על "Create Web Service" - Render יבנה וידפלוי את השרת אוטומטית.

## עדכון הפרונט
אחרי ההתקנה, עדכן את `src/components/WhatsAppManager.tsx`:

1. החלף את כל קריאות ה-`supabase.functions.invoke('whatsapp-manager/...')` 
2. לקריאות HTTP ל: `https://your-app-name.onrender.com/api/whatsapp/...`
3. הוסף WebSocket connection עם `socket.io-client`

## API Endpoints

### POST /api/whatsapp/start
התחל session חדש
```json
{
  "clientId": "uuid",
  "sessionName": "default"
}
```

### GET /api/whatsapp/status/:clientId
קבל סטטוס session

### POST /api/whatsapp/send
שלח הודעה
```json
{
  "clientId": "uuid",
  "sessionName": "default",
  "to": "0541234567",
  "message": "Hello!",
  "leadId": "uuid" (optional)
}
```

### POST /api/whatsapp/disconnect
נתק session
```json
{
  "clientId": "uuid",
  "sessionName": "default"
}
```

### GET /api/whatsapp/messages/:clientId
קבל היסטוריית הודעות

## WebSocket Events

### Client -> Server
- `subscribe` - הרשם לעדכוני session
- `unsubscribe` - בטל הרשמה

### Server -> Client
- `qr-code` - QR code חדש נוצר
- `connected` - נכנס לחיבור
- `disconnected` - התנתק
- `message` - הודעה חדשה

## תחזוקה

### לוגים
ראה לוגים ב-Render Dashboard -> Logs

### Restart
ניתן לעשות restart ידני דרך Render Dashboard

### עדכון קוד
כל push לריפו יפעיל deploy אוטומטי
