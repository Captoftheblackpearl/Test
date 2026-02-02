# Deployment Guide

Your Personal Assistant Bot uses **Socket Mode**, so it doesn't need webhooks. It just needs a server running 24/7 to maintain the connection.

## Quick Deployment Options

### Option 1: Railway (Easiest) ⭐
Railway is simple, free tier available, and perfect for this bot.

1. **Create Railway Account**: https://railway.app
2. **Connect GitHub Repo**: Link your repository
3. **Add Environment Variables**:
   - `SLACK_BOT_TOKEN` - Your bot token
   - `SLACK_APP_TOKEN` - Your app token
   - `__firebase_config` - Your Firebase config JSON
   - `__app_id` - Your app ID (default: `personal-bot-default`)
   - `PORT` - Keep as `10001`

4. **Deploy**: Railway auto-deploys from your git push

### Option 2: Render (Free Tier)
Similar to Railway, also easy setup.

1. **Create Render Account**: https://render.com
2. **New Web Service** → Connect GitHub
3. **Build Command**: `npm install`
4. **Start Command**: `npm start`
5. **Add Environment Variables** (same as Railway)
6. **Deploy**

### Option 3: Fly.io
Great for persistent, low-cost deployments.

```bash
# Install Fly CLI
brew install flyctl  # macOS
# or on Linux: curl -L https://fly.io/install.sh | sh

# Login
fly auth login

# Launch app
fly launch

# Add secrets (environment variables)
fly secrets set SLACK_BOT_TOKEN=xoxb-...
fly secrets set SLACK_APP_TOKEN=xapp-...
fly secrets set __firebase_config='{"apiKey":"..."}'
fly secrets set __app_id=personal-bot-default

# Deploy
fly deploy
```

### Option 4: Docker + Cloud Run (Google Cloud)
For containerized deployment:

1. **Create Dockerfile**:
```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
CMD ["node", "app.js"]
```

2. **Deploy to Google Cloud Run**:
```bash
gcloud run deploy task-bot \
  --source . \
  --platform managed \
  --region us-central1 \
  --set-env-vars SLACK_BOT_TOKEN=xoxb-...
```

### Option 5: Self-Hosted VPS (DigitalOcean, Linode)
For full control with a $5-10/month server:

```bash
# SSH into your server
ssh root@your-server-ip

# Install Node.js
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs

# Clone your repo
git clone your-repo-url
cd task-bot

# Install PM2 for process management
sudo npm install -g pm2

# Copy .env file (configure with your tokens)
nano .env  # Paste your configuration

# Install dependencies
npm install

# Start with PM2
pm2 start app.js --name "task-bot"
pm2 startup
pm2 save

# Done! Bot runs forever, auto-restarts on reboot/crash
```

### Option 6: Heroku (Legacy, Now Paid)
Heroku deprecated free tier, but still available:

```bash
# Install Heroku CLI
# https://devcenter.heroku.com/articles/heroku-cli

heroku create your-app-name
heroku config:set SLACK_BOT_TOKEN=xoxb-...
heroku config:set SLACK_APP_TOKEN=xapp-...
heroku config:set __firebase_config='{"apiKey":"..."}'
git push heroku main
```

## Recommendation

**For simplicity**: Use **Railway** or **Render** (just connect GitHub, set env vars, done)

**For reliability**: Use **Fly.io** (better uptime SLA)

**For cost**: Use **self-hosted VPS** with PM2 ($5-10/month)

## Monitoring & Logs

### Railway/Render
- View logs directly in dashboard
- Automatic restarts on crash

### Fly.io
```bash
fly logs
```

### Self-Hosted with PM2
```bash
pm2 logs task-bot
pm2 status
pm2 restart task-bot
```

## Environment Variables Checklist

Before deploying, ensure you have:
- ✅ `SLACK_BOT_TOKEN` from Slack API
- ✅ `SLACK_APP_TOKEN` from Slack API  
- ✅ `__firebase_config` - Complete Firebase JSON
- ✅ `__app_id` - Your app identifier
- ✅ `PORT` - Set to `10001` (or platform default)

## Troubleshooting

**Bot won't start**: Check logs for Firebase/Slack token errors
**Connection drops**: Check network stability and token validity
**Commands not working**: Verify Slack slash command registration points to your deployment

## Health Check

Your bot runs a health check server on the configured PORT:
- Endpoint: `http://localhost:10001` or `http://your-domain/`
- Response: "Personal Assistant is online."

Some platforms ping this for uptime verification.

## After Deployment

1. **Test commands** in your Slack workspace
2. **Monitor logs** for errors
3. **Set up auto-restart** on your hosting platform
4. **Rotate tokens** periodically for security
