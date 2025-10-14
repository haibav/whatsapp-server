# WhatsApp Baileys Server

שרת Node.js עם Express ו-Baileys לניהול חיבורי WhatsApp עבור מערכת ה-CRM.

## פריסה על Render

### שלב 1: העלאת הקוד
1. העתק את התיקייה `whatsapp-server-deploy` לריפו של הפרויקט
2. Commit ו-Push ל-GitHub/GitLab

### שלב 2: יצירת Web Service
1. היכנס ל-[Render Dashboard](https://dashboard.render.com/)
2. לחץ על "New" -> "Web Service"
3. חבר את הריפו שלך
4. הגדרות:
   - **Name**: `whatsapp-baileys-server`
   - **Runtime**: Node
   - **Root Directory**: `whatsapp-server-deploy` (או השם שנתת לתיקייה)
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Plan**: Starter ($7/month) או Free (עם cold starts)

### שלב 3: Environment Variables
הוסף את משתני הסביבה הבאים ב-Render Dashboard:
- `SUPABASE_URL`: https://jglhwwubdywvboryuype.supabase.co
- `SUPABASE_SERVICE_KEY`: [מפתח ה-Service Role מSupabase - מצא אותו ב-Supabase Dashboard -> Settings -> API]

**חשוב:** אל תגדיר `PORT` ידנית - Render מגדיר אותו אוטומטית!

### שלב 4: Persistent Disk
1. לחץ על "Disks" בתפריט השרת
2. הוסף דיסק חדש:
   - **Name**: whatsapp-auth-data
   - **Mount Path**: `/data`
   - **Size**: 1GB

### שלב 5: Deploy
לחץ על "Create Web Service" - Render יבנה וידפלוי את השרת אוטומטית.

## עדכון הפרונט

אחרי ההתקנה, עדכן את הקובץ `.env` בפרויקט הראשי:

```env
VITE_WHATSAPP_SERVER_URL=https://your-app-name.onrender.com
```

**חשוב:**
- השתמש ב-HTTPS (לא HTTP)
- החלף `your-app-name` בשם השרת שלך ב-Render
- עשה restart לשרת הפיתוח אחרי עדכון ה-`.env`

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

## פתרון בעיות נפוצות

### QR Code לא מופיע
1. בדוק את `/health` endpoint: `https://your-app.onrender.com/health`
2. ודא ש-`dataDirectory: "exists"` ו-`supabaseConnected: true`
3. בדוק logs ב-Render Dashboard לשגיאות
4. ודא ש-Persistent Disk מחובר ל-`/data`
5. נסה disconnect ו-start מחדש

### Cold Starts (תוכנית Free)
- בתוכנית Free, השרת עלול להירדם אחרי 15 דקות חוסר פעילות
- פנייה ראשונה לאחר cold start תיקח 30-60 שניות
- שדרג ל-Starter plan כדי למנוע cold starts

### החיבור מתנתק
1. בדוק שה-Persistent Disk קיים ותקין
2. ודא שמשתני הסביבה נכונים
3. בדוק logs לשגיאות `ECONNRESET` או `ETIMEDOUT`
4. לעיתים WhatsApp Web דורש scan מחדש של QR

### שגיאות Supabase
- ודא שה-`SUPABASE_SERVICE_KEY` הוא Service Role Key ולא Anon Key
- בדוק שהטבלאות `whatsapp_sessions` ו-`whatsapp_messages` קיימות
- ודא שיש RLS policies מתאימות

### שליחת הודעות נכשלת
1. ודא שהמספר בפורמט בינלאומי (972...)
2. בדוק שהחיבור במצב "connected"
3. ודא שהמספר רשום ב-WhatsApp
4. בדוק logs לשגיאות מדויקות

### Debug Mode
להפעלת לוגים מפורטים, הוסף משתנה סביבה ב-Render:
```
LOG_LEVEL=debug
```

## בדיקת תקינות

אחרי הפריסה, בדוק:

1. **Health Check:**
   ```bash
   curl https://your-app.onrender.com/health
   ```
   תשובה צפויה:
   ```json
   {
     "status": "ok",
     "activeSessions": 0,
     "uptime": 123.45,
     "supabaseConnected": true,
     "dataDirectory": "exists",
     "timestamp": "2025-01-15T10:30:00.000Z"
   }
   ```

2. **בדיקת חיבור מהפרונט:**
   - היכנס לעמוד WhatsApp ב-CRM
   - לחץ "התחל חיבור"
   - QR code אמור להופיע תוך 5-10 שניות
   - סרוק עם WhatsApp
   - סטטוס ישתנה ל-"מחובר"

3. **שליחת הודעה:**
   - בחר ליד מהרשימה
   - כתוב הודעה
   - לחץ שלח
   - ההודעה אמורה להישלח מיד

## תמיכה

אם נתקלת בבעיה:
1. בדוק את ה-logs ב-Render Dashboard
2. ודא שכל משתני הסביבה נכונים
3. בדוק את ה-Console של הדפדפן לשגיאות
4. נסה disconnect ו-start מחדש
