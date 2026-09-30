# CrewDesk Backend

Express, MongoDB, authentication, email, and Aircall API for CrewDesk.

## Local development

```powershell
npm install
Copy-Item .env.example .env
npm run dev
```

Configure MongoDB and provider credentials in `.env`. Never commit that file.

## Test

```powershell
npm test 
```

## Productions

The included `vercel.json` deploys `backend/api/index.js` as the production serverless API.

```powershell
npx vercel@latest deploy --prod --yes
```

Production health endpoint: `https://crewdesk-api.vercel.app/health`.

