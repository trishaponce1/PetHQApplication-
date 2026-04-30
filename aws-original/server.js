// server.js — PetHQ App Tier / MCP Orchestrator v1.3.0
const http = require('http');
const os = require('os');
const { buildContext } = require('./context');
const { invokeTools } = require('./tools');
const { getSecrets } = require('./secrets');
const { Pool } = require('pg');

// Pool and Dify key initialized after secrets are loaded on startup
let pool;
let DIFY_API_KEY;

// Cognito Configuration
const COGNITO = {
  userPoolId: '[COGNITO USER POOL ID]',
  clientId: '[COGNITO CLIENT ID]',
  clientSecret: null,
  domain: '[COGNITO DOMAIN]',
  redirectUri: '[REDIRECT URI]',
  logoutUri: '[LOGOUT URI]',
  region: 'us-east-1'
};

// ── DynamoDB Session Store ──
// Sessions are stored in DynamoDB so they persist across EC2 instances and restarts
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand, GetCommand, DeleteCommand } = require('@aws-sdk/lib-dynamodb');
const dynamoClient = new DynamoDBClient({ region: 'us-east-1' });
const dynamo = DynamoDBDocumentClient.from(dynamoClient);
const SESSION_TABLE = 'pethq-sessions';
const SESSION_TTL_SECONDS = 86400; // 24 hours

function generateSessionId() {
  return Math.random().toString(36).substring(2) + Date.now().toString(36);
}

async function saveSession(sessionId, userData) {
  try {
    await dynamo.send(new PutCommand({
      TableName: SESSION_TABLE,
      Item: {
        session_id: sessionId,
        userData,
        ttl: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS,
        createdAt: new Date().toISOString()
      }
    }));
    console.log(`[DynamoDB] Session saved: ${sessionId}`);
  } catch (err) {
    console.error('[DynamoDB] Save session error:', err.message);
  }
}

async function getSessionUser(req) {
  const cookie = req.headers.cookie || '';
  const match = cookie.match(/pethq_session=([^;]+)/);
  if (!match) return null;
  try {
    const result = await dynamo.send(new GetCommand({
      TableName: SESSION_TABLE,
      Key: { session_id: match[1] }
    }));
    return result.Item ? result.Item.userData : null;
  } catch (err) {
    console.error('[DynamoDB] Get session error:', err.message);
    return null;
  }
}

async function deleteSession(req) {
  const cookie = req.headers.cookie || '';
  const match = cookie.match(/pethq_session=([^;]+)/);
  if (!match) return;
  try {
    await dynamo.send(new DeleteCommand({
      TableName: SESSION_TABLE,
      Key: { session_id: match[1] }
    }));
    console.log(`[DynamoDB] Session deleted: ${match[1]}`);
  } catch (err) {
    console.error('[DynamoDB] Delete session error:', err.message);
  }
}

const getServerInfo = () => ({
  hostname: os.hostname(), uptime: Math.floor(os.uptime() / 60),
  memory: Math.round((1 - os.freemem() / os.totalmem()) * 100),
  nodeVersion: process.version, timestamp: new Date().toISOString(), region: 'us-east-1'
});

const buildHtml = (info) => `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>PetHQ - AI Pet Care Platform</title>
<link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600;700;800;900&family=DM+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{--blue:#1E90FF;--blue-dark:#1565C0;--yellow:#FFC83D;--orange:#FF8C42;--bg:#F4F9FF;--bg2:#EAF4FF;--text:#1A1A1A;--muted:rgba(26,26,26,0.65);--border:rgba(30,144,255,0.15);--success:#2ECC71;}
html{scroll-behavior:smooth}
body{font-family:'DM Sans',sans-serif;background:linear-gradient(180deg,var(--bg),var(--bg2));color:var(--text);min-height:100vh;overflow-x:hidden}
body::before{content:'';position:fixed;inset:0;background:radial-gradient(ellipse 70% 50% at 10% 0%,rgba(30,144,255,.18) 0%,transparent 55%),radial-gradient(ellipse 50% 70% at 95% 95%,rgba(255,140,66,.18) 0%,transparent 55%);pointer-events:none;z-index:0}
.paw-float{position:fixed;pointer-events:none;z-index:0;opacity:0;animation:floatUp linear infinite}
@keyframes floatUp{0%{transform:translateY(105vh) rotate(0deg);opacity:0}8%{opacity:.06}92%{opacity:.06}100%{transform:translateY(-10vh) rotate(360deg);opacity:0}}
nav{position:sticky;top:0;z-index:100;display:flex;align-items:center;justify-content:space-between;padding:1.1rem 3rem;background:rgba(244,249,255,.82);backdrop-filter:blur(16px);border-bottom:1px solid var(--border)}
.logo{display:flex;align-items:center;gap:.8rem;text-decoration:none}
.logo-icon{width:42px;height:42px;background:linear-gradient(135deg,var(--blue),var(--orange));border-radius:12px;display:flex;align-items:center;justify-content:center;font-size:1.35rem;transform:rotate(-6deg);transition:transform .3s cubic-bezier(.34,1.56,.64,1);box-shadow:0 6px 18px rgba(30,144,255,.35)}
.logo-icon:hover{transform:rotate(6deg) scale(1.08)}
.logo-name{font-size:1.7rem;font-weight:900;color:var(--blue-dark);letter-spacing:-.6px}
.logo-name span{color:var(--yellow)}
.nav-right{display:flex;align-items:center;gap:1rem}
.status-pill{display:flex;align-items:center;gap:.5rem;background:rgba(46,204,113,.12);border:1px solid rgba(46,204,113,.28);color:#1D7C47;padding:.35rem .9rem;border-radius:100px;font-family:'DM Mono',monospace;font-size:.72rem;font-weight:500}
.status-dot{width:7px;height:7px;background:var(--success);border-radius:50%;animation:blink 1.8s ease infinite}
@keyframes blink{0%,100%{opacity:1}50%{opacity:.45}}
.nav-tag{font-family:'DM Mono',monospace;font-size:.68rem;background:rgba(30,144,255,.12);color:var(--blue-dark);padding:.3rem .75rem;border-radius:100px;border:1px solid rgba(30,144,255,.22);font-weight:500}
.hero{position:relative;z-index:1;display:flex;flex-direction:column;align-items:center;text-align:center;padding:6rem 2rem 4rem}
.hero-eyebrow{font-family:'DM Mono',monospace;font-size:.72rem;color:var(--blue-dark);letter-spacing:2px;text-transform:uppercase;margin-bottom:1.2rem;padding:.45rem 1rem;border:1px solid rgba(30,144,255,.25);border-radius:100px;background:rgba(30,144,255,.06);display:inline-block}
.hero-title{font-size:clamp(3rem,7vw,5.5rem);font-weight:900;line-height:1.03;color:var(--blue-dark);letter-spacing:-2px;margin-bottom:1.5rem;max-width:820px}
.hero-title em{font-style:normal;color:var(--orange)}
.hero-sub{font-size:1.1rem;color:var(--muted);max-width:560px;line-height:1.7;margin-bottom:2.5rem}
.hero-cta{display:flex;gap:1rem;flex-wrap:wrap;justify-content:center}
.btn{padding:.9rem 2rem;border-radius:999px;font-family:'DM Sans',sans-serif;font-size:.92rem;font-weight:800;cursor:pointer;transition:all .25s cubic-bezier(.34,1.56,.64,1);border:none;display:inline-flex;align-items:center;gap:.55rem}
.btn-primary{background:linear-gradient(135deg,var(--blue),var(--orange));color:white;box-shadow:0 8px 25px rgba(30,144,255,.35)}
.btn-primary:hover{transform:translateY(-3px) scale(1.03)}
.btn-outline{background:rgba(255,255,255,.65);color:var(--blue-dark);border:2px solid rgba(30,144,255,.45)}
.btn-outline:hover{background:var(--blue);color:white;transform:translateY(-3px) scale(1.03)}
.section{position:relative;z-index:1;max-width:1100px;margin:0 auto;padding:3rem 2rem}
.section-label{font-family:'DM Mono',monospace;font-size:.7rem;letter-spacing:2px;text-transform:uppercase;color:rgba(26,26,26,.55);margin-bottom:2rem}
.features-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:1.2rem}
.feature-card{background:rgba(255,255,255,.9);border:1px solid var(--border);border-radius:22px;padding:1.8rem;transition:all .3s cubic-bezier(.34,1.56,.64,1);position:relative;overflow:hidden;box-shadow:0 14px 40px rgba(21,101,192,.08)}
.feature-card::before{content:'';position:absolute;top:0;left:0;right:0;height:4px;border-radius:22px 22px 0 0;background:linear-gradient(90deg,var(--blue),var(--yellow),var(--orange));transform:scaleX(0);transform-origin:left;transition:transform .3s ease}
.feature-card:hover{transform:translateY(-7px);box-shadow:0 22px 55px rgba(21,101,192,.14)}
.feature-card:hover::before{transform:scaleX(1)}
.feature-icon{font-size:2rem;margin-bottom:1rem;display:block}
.feature-name{font-size:1.05rem;font-weight:900;color:var(--blue-dark);margin-bottom:.5rem}
.feature-desc{font-size:.86rem;color:var(--muted);line-height:1.6}
.feature-badge{display:inline-block;margin-top:.9rem;font-family:'DM Mono',monospace;font-size:.62rem;padding:.28rem .65rem;border-radius:999px;font-weight:600}
.badge-soon{background:rgba(255,200,61,.16);color:#8A6300;border:1px solid rgba(255,200,61,.35)}
.badge-live{background:rgba(46,204,113,.14);color:#1D7C47;border:1px solid rgba(46,204,113,.35)}

/* Profile Section */
.profile-section{position:relative;z-index:1;max-width:1100px;margin:0 auto;padding:0 2rem 3rem}
.profile-wrapper{background:rgba(255,255,255,.92);border:1px solid var(--border);border-radius:24px;overflow:hidden;box-shadow:0 20px 60px rgba(21,101,192,.12)}
.profile-header{padding:1.2rem 1.8rem;background:linear-gradient(135deg,var(--blue-dark),var(--blue));display:flex;align-items:center;gap:1rem}
.profile-header-icon{width:36px;height:36px;background:rgba(255,255,255,.2);border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:1.2rem}
.profile-header-text h3{font-size:1rem;font-weight:900;color:white}
.profile-header-text p{font-size:.72rem;color:rgba(255,255,255,.75);font-family:'DM Mono',monospace}
.profile-body{padding:1.8rem}
.profile-tabs{display:flex;gap:.5rem;margin-bottom:1.5rem;border-bottom:1px solid var(--border);padding-bottom:.75rem;flex-wrap:wrap}
.profile-tab{font-family:'DM Mono',monospace;font-size:.72rem;padding:.4rem 1rem;border-radius:100px;border:1px solid var(--border);background:transparent;cursor:pointer;color:var(--muted);transition:all .2s}
.profile-tab.active{background:var(--blue);color:white;border-color:var(--blue)}
.pet-list{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:1rem;margin-bottom:1.5rem}
.pet-card{background:var(--bg);border:2px solid var(--border);border-radius:16px;padding:1.2rem;cursor:pointer;transition:all .25s cubic-bezier(.34,1.56,.64,1);user-select:none}
.pet-card:hover{border-color:var(--blue);background:rgba(30,144,255,.06);transform:translateY(-3px)}
.pet-card.selected{border-color:var(--blue);background:rgba(30,144,255,.1);transform:translateY(-3px)}
.pet-card-name{font-weight:900;font-size:1.05rem;color:var(--blue-dark);margin-bottom:.3rem;pointer-events:none}
.pet-card-detail{font-size:.8rem;color:var(--muted);font-family:'DM Mono',monospace;pointer-events:none}
.pet-card-badge{display:inline-block;margin-top:.6rem;font-family:'DM Mono',monospace;font-size:.6rem;padding:.2rem .55rem;border-radius:999px;background:rgba(46,204,113,.14);color:#1D7C47;border:1px solid rgba(46,204,113,.35);pointer-events:none}
.form-grid{display:grid;grid-template-columns:1fr 1fr;gap:1rem}
.form-group{display:flex;flex-direction:column;gap:.4rem}
.form-group.full{grid-column:1/-1}
.form-label{font-family:'DM Mono',monospace;font-size:.68rem;color:var(--muted);text-transform:uppercase;letter-spacing:1px}
.form-input,.form-select{background:var(--bg);border:1px solid rgba(30,144,255,.25);border-radius:10px;padding:.65rem 1rem;font-family:'DM Sans',sans-serif;font-size:.88rem;color:var(--text);outline:none;transition:border-color .2s,box-shadow .2s;width:100%}
.form-input:focus,.form-select:focus{border-color:rgba(30,144,255,.65);box-shadow:0 0 0 4px rgba(30,144,255,.12)}
.form-actions{display:flex;gap:.75rem;margin-top:1.2rem;flex-wrap:wrap}
.btn-sm{padding:.6rem 1.4rem;font-size:.82rem;border-radius:999px;font-family:'DM Sans',sans-serif;font-weight:800;cursor:pointer;border:none;transition:all .25s cubic-bezier(.34,1.56,.64,1)}
.btn-save{background:linear-gradient(135deg,var(--blue),var(--orange));color:white;box-shadow:0 6px 18px rgba(30,144,255,.3)}
.btn-save:hover{transform:translateY(-2px)}
.btn-cancel{background:rgba(255,255,255,.8);color:var(--muted);border:1px solid var(--border)}
.btn-danger{background:rgba(231,76,60,.1);color:#c0392b;border:1px solid rgba(231,76,60,.3)}
.btn-danger:hover{background:rgba(231,76,60,.2)}
.active-pet-banner{background:rgba(30,144,255,.08);border:1px solid rgba(30,144,255,.2);border-radius:12px;padding:.8rem 1.2rem;margin-bottom:1rem;display:flex;align-items:center;gap:.75rem;font-size:.85rem;color:var(--blue-dark)}
.status-msg{margin-top:.75rem;font-family:'DM Mono',monospace;font-size:.72rem;color:var(--blue-dark)}
.detail-view{background:var(--bg);border-radius:16px;padding:1.4rem;margin-bottom:1.2rem}
.detail-grid{display:grid;grid-template-columns:1fr 1fr;gap:.75rem}
.detail-item{display:flex;flex-direction:column;gap:.2rem}
.detail-label{font-family:'DM Mono',monospace;font-size:.62rem;color:var(--muted);text-transform:uppercase;letter-spacing:1px}
.detail-value{font-size:.88rem;color:var(--text);font-weight:500}
.list-item{background:white;border:1px solid var(--border);border-radius:12px;padding:1rem 1.2rem;margin-bottom:.6rem;display:flex;justify-content:space-between;align-items:flex-start}
.list-item-main{flex:1}
.list-item-title{font-weight:700;color:var(--blue-dark);font-size:.9rem}
.list-item-sub{font-size:.8rem;color:var(--muted);font-family:'DM Mono',monospace;margin-top:.2rem}
.goal-badge{font-family:'DM Mono',monospace;font-size:.62rem;padding:.2rem .55rem;border-radius:999px;background:rgba(30,144,255,.12);color:var(--blue-dark);border:1px solid rgba(30,144,255,.25)}
.empty-state{text-align:center;padding:2rem;color:var(--muted);font-size:.88rem}

/* Chat Section */
.chat-section{position:relative;z-index:1;max-width:1100px;margin:0 auto;padding:0 2rem 4rem}
.chat-wrapper{background:rgba(255,255,255,.92);border:1px solid var(--border);border-radius:24px;overflow:hidden;box-shadow:0 20px 60px rgba(21,101,192,.12)}
.chat-header{padding:1.2rem 1.8rem;background:linear-gradient(135deg,var(--blue-dark),var(--blue));display:flex;align-items:center;gap:1rem}
.chat-header-icon{width:36px;height:36px;background:rgba(255,255,255,.2);border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:1.2rem}
.chat-header-text h3{font-size:1rem;font-weight:900;color:white}
.chat-header-text p{font-size:.72rem;color:rgba(255,255,255,.75);font-family:'DM Mono',monospace}
.chat-dify-badge{margin-left:auto;font-family:'DM Mono',monospace;font-size:.65rem;background:rgba(255,200,61,.22);color:#FFE7A0;border:1px solid rgba(255,200,61,.35);padding:.3rem .7rem;border-radius:999px}
.chat-pet-context{padding:.75rem 1.5rem;background:rgba(30,144,255,.06);border-bottom:1px solid var(--border);font-family:'DM Mono',monospace;font-size:.7rem;color:var(--blue-dark);display:flex;align-items:center;gap:.5rem;flex-wrap:wrap}
.mcp-tools-badge{padding:.2rem .6rem;background:rgba(255,200,61,.2);border:1px solid rgba(255,200,61,.4);border-radius:999px;font-size:.65rem;color:#8A6300}
.chat-messages{padding:1.5rem;min-height:220px;max-height:380px;display:flex;flex-direction:column;gap:1rem;overflow-y:auto}
.msg{display:flex;gap:.75rem}
.msg.user{flex-direction:row-reverse}
.msg-avatar{width:32px;height:32px;border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:.9rem;flex-shrink:0}
.msg-avatar.ai{background:linear-gradient(135deg,var(--blue-dark),var(--blue));color:white}
.msg-avatar.user{background:linear-gradient(135deg,var(--orange),var(--yellow));color:#2B1A00}
.msg-bubble{max-width:75%;padding:.85rem 1.1rem;border-radius:16px;font-size:.88rem;line-height:1.6}
.msg.ai .msg-bubble{background:rgba(30,144,255,.08);color:var(--text);border-radius:6px 16px 16px 16px}
.msg.user .msg-bubble{background:linear-gradient(135deg,var(--orange),#FFB25C);color:white;border-radius:16px 6px 16px 16px}
.msg-typing{display:flex;align-items:center;gap:4px;padding:.85rem 1.2rem;background:rgba(30,144,255,.08);border-radius:6px 16px 16px 16px}
.typing-dot{width:6px;height:6px;background:rgba(26,26,26,.55);border-radius:50%;animation:typingBounce 1.2s ease infinite}
.typing-dot:nth-child(2){animation-delay:.2s}.typing-dot:nth-child(3){animation-delay:.4s}
@keyframes typingBounce{0%,80%,100%{transform:translateY(0)}40%{transform:translateY(-6px)}}
.chat-input-bar{padding:1rem 1.5rem;border-top:1px solid var(--border);display:flex;gap:.75rem;align-items:center}
.chat-input{flex:1;background:rgba(244,249,255,.9);border:1px solid rgba(30,144,255,.25);border-radius:999px;padding:.75rem 1.2rem;font-family:'DM Sans',sans-serif;font-size:.88rem;color:var(--text);outline:none;transition:border-color .2s,box-shadow .2s}
.chat-input:focus{border-color:rgba(30,144,255,.65);box-shadow:0 0 0 4px rgba(30,144,255,.12)}
.chat-input:disabled{opacity:.6;cursor:not-allowed}
.chat-send{width:42px;height:42px;background:linear-gradient(135deg,var(--blue),var(--orange));border:none;border-radius:50%;color:white;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:all .25s cubic-bezier(.34,1.56,.64,1);font-size:1rem}
.chat-send:hover{transform:scale(1.08)}
.chat-send:disabled{opacity:.5;cursor:not-allowed;transform:none}
.dify-note{text-align:center;font-family:'DM Mono',monospace;font-size:.68rem;color:rgba(26,26,26,.6);padding:.75rem;border-top:1px solid var(--border);background:rgba(244,249,255,.6)}
.infra-section{position:relative;z-index:1;max-width:1100px;margin:0 auto;padding:0 2rem 5rem}
.infra-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:1rem}
.infra-card{background:rgba(255,255,255,.9);border:1px solid var(--border);border-radius:18px;padding:1.4rem;transition:transform .25s ease;box-shadow:0 12px 35px rgba(21,101,192,.08)}
.infra-card:hover{transform:translateY(-5px)}
.infra-label{font-family:'DM Mono',monospace;font-size:.65rem;color:rgba(26,26,26,.55);letter-spacing:1.5px;text-transform:uppercase;margin-bottom:.5rem}
.infra-value{font-family:'DM Mono',monospace;font-size:.92rem;font-weight:500;color:var(--blue-dark);word-break:break-all}
.infra-icon{font-size:1.4rem;margin-bottom:.6rem;display:block}
.mem-bar{height:6px;background:rgba(30,144,255,.12);border-radius:999px;margin-top:.6rem;overflow:hidden}
.mem-fill{height:100%;background:linear-gradient(90deg,var(--blue),var(--orange));border-radius:999px}
footer{position:relative;z-index:1;border-top:1px solid var(--border);padding:1.5rem 3rem;display:flex;align-items:center;justify-content:space-between;background:rgba(244,249,255,.75);backdrop-filter:blur(10px)}
.footer-left{font-family:'DM Mono',monospace;font-size:.68rem;color:rgba(26,26,26,.6)}
.footer-right{display:flex;gap:1rem;flex-wrap:wrap;justify-content:center}
.footer-tag{font-family:'DM Mono',monospace;font-size:.65rem;padding:.28rem .7rem;border-radius:999px;border:1px solid rgba(30,144,255,.22);background:rgba(255,255,255,.7);color:rgba(26,26,26,.65)}
@media(max-width:640px){nav{padding:1rem 1.2rem}.hero{padding:4rem 1.2rem 2.5rem}.section,.chat-section,.infra-section,.profile-section{padding-left:1.2rem;padding-right:1.2rem}footer{flex-direction:column;gap:.75rem;text-align:center}.form-grid{grid-template-columns:1fr}.detail-grid{grid-template-columns:1fr}}
</style>
</head>
<body>
<div id="pawBg" style="position:fixed;inset:0;pointer-events:none;z-index:0;overflow:hidden"></div>
<nav>
  <a class="logo" href="#"><div class="logo-icon">&#x1F43E;</div><span class="logo-name">Pet<span>HQ</span></span></a>
  <div class="nav-right">
    <span class="status-pill"><span class="status-dot"></span>SYSTEM ONLINE</span>
    <span class="nav-tag">v1.2.0 &middot; SPRINT 3</span>
    <div id="authNav" style="display:flex;align-items:center;gap:.75rem"></div>
  </div>
</nav>

<section class="hero">
  <span class="hero-eyebrow">AI-Powered Pet Care &middot; AWS &middot; Dify &middot; Ollama &middot; RDS</span>
  <h1 class="hero-title">Your pet's health,<br><em>brightly</em> managed.</h1>
  <p class="hero-sub">PetHQ centralizes pet profiles, medical records, feeding schedules, and training goals — powered by a self-hosted AI assistant that knows your pet by name.</p>
  <div class="hero-cta">
    <button class="btn btn-primary" onclick="document.getElementById('profileSection').scrollIntoView({behavior:'smooth'})">&#x1F436; My Pets</button>
    <button class="btn btn-outline" onclick="document.getElementById('chatSection').scrollIntoView({behavior:'smooth'})">&#x1F4AC; AI Assistant</button>
  </div>
</section>

<section class="section">
  <div class="section-label">// Core Features</div>
  <div class="features-grid">
    <div class="feature-card"><span class="feature-icon">&#x1F436;</span><div class="feature-name">Pet Profiles</div><div class="feature-desc">Store breed, age, weight, and full medical history — saved to AWS RDS PostgreSQL.</div><span class="feature-badge badge-live">&#x26A1; LIVE</span></div>
    <div class="feature-card"><span class="feature-icon">&#x1F37D;</span><div class="feature-name">Feeding Schedules</div><div class="feature-desc">Set portions, meal times, and food types stored in RDS.</div><span class="feature-badge badge-live">&#x26A1; LIVE</span></div>
    <div class="feature-card"><span class="feature-icon">&#x1F489;</span><div class="feature-name">Medical Records</div><div class="feature-desc">Vaccinations, vet visits, medications, and allergy tracking in one place.</div><span class="feature-badge badge-live">&#x26A1; LIVE</span></div>
    <div class="feature-card"><span class="feature-icon">&#x1F3AF;</span><div class="feature-name">Training Goals</div><div class="feature-desc">Set and track training goals for your pet stored in RDS.</div><span class="feature-badge badge-live">&#x26A1; LIVE</span></div>
    <div class="feature-card"><span class="feature-icon">&#x1F916;</span><div class="feature-name">AI Assistant</div><div class="feature-desc">Personalized advice via Dify + Ollama, grounded in real RDS data via MCP tools.</div><span class="feature-badge badge-live">&#x26A1; LIVE</span></div>
  </div>
</section>

<section class="profile-section" id="profileSection">
  <div class="section-label">// Pet Profiles &mdash; AWS RDS PostgreSQL</div>
  <div class="profile-wrapper">
    <div class="profile-header">
      <div class="profile-header-icon">&#x1F436;</div>
      <div class="profile-header-text"><h3>My Pets</h3><p>Stored in AWS RDS &middot; Context injected into AI via MCP</p></div>
    </div>
    <div class="profile-body">
      <div class="profile-tabs" id="profileTabs">
        <button class="profile-tab active" onclick="showTab('list')">My Pets</button>
        <button class="profile-tab" onclick="showTab('add')">+ Add Pet</button>
      </div>

      <!-- PET LIST -->
      <div id="tab-list">
        <div id="petList" class="pet-list"><p style="color:var(--muted);font-size:.85rem">Loading pets...</p></div>
        <div id="activePetBanner" style="display:none" class="active-pet-banner">&#x1F43E; <span id="activePetText"></span></div>
      </div>

      <!-- ADD PET -->
      <div id="tab-add" style="display:none">
        <div class="form-grid">
          <div class="form-group"><label class="form-label">Pet Name *</label><input class="form-input" id="f-name" type="text" placeholder="e.g. Tony"></div>
          <div class="form-group"><label class="form-label">Species</label><input class="form-input" id="f-species" type="text" placeholder="e.g. Dog, Cat"></div>
          <div class="form-group"><label class="form-label">Breed</label><input class="form-input" id="f-breed" type="text" placeholder="e.g. Lab Mix"></div>
          <div class="form-group"><label class="form-label">Age</label><input class="form-input" id="f-age" type="text" placeholder="e.g. 3 years"></div>
          <div class="form-group"><label class="form-label">Weight</label><input class="form-input" id="f-weight" type="text" placeholder="e.g. 50lbs"></div>
          <div class="form-group"><label class="form-label">Food Brand</label><input class="form-input" id="f-food" type="text" placeholder="e.g. Open Farm"></div>
          <div class="form-group full"><label class="form-label">Allergies / Dietary Restrictions</label><input class="form-input" id="f-allergies" type="text" placeholder="e.g. None, Chicken allergy"></div>
          <div class="form-group full"><label class="form-label">Medical Notes</label><input class="form-input" id="f-medical" type="text" placeholder="e.g. Up to date on vaccines"></div>
        </div>
        <div class="form-actions">
          <button class="btn-sm btn-save" onclick="savePet()">&#x1F4BE; Save Pet</button>
          <button class="btn-sm btn-cancel" onclick="showTab('list')">Cancel</button>
        </div>
        <p id="saveStatus" class="status-msg"></p>
      </div>

      <!-- PET DETAIL -->
      <div id="tab-detail" style="display:none">
        <div id="detailContent"></div>
      </div>

      <!-- EDIT PET -->
      <div id="tab-edit" style="display:none">
        <div class="form-grid">
          <div class="form-group"><label class="form-label">Pet Name *</label><input class="form-input" id="e-name" type="text"></div>
          <div class="form-group"><label class="form-label">Species</label><input class="form-input" id="e-species" type="text"></div>
          <div class="form-group"><label class="form-label">Breed</label><input class="form-input" id="e-breed" type="text"></div>
          <div class="form-group"><label class="form-label">Age</label><input class="form-input" id="e-age" type="text"></div>
          <div class="form-group"><label class="form-label">Weight</label><input class="form-input" id="e-weight" type="text"></div>
          <div class="form-group"><label class="form-label">Food Brand</label><input class="form-input" id="e-food" type="text"></div>
          <div class="form-group full"><label class="form-label">Allergies</label><input class="form-input" id="e-allergies" type="text"></div>
          <div class="form-group full"><label class="form-label">Medical Notes</label><input class="form-input" id="e-medical" type="text"></div>
        </div>
        <div class="form-actions">
          <button class="btn-sm btn-save" onclick="updatePet()">&#x1F4BE; Update Pet</button>
          <button class="btn-sm btn-cancel" onclick="showPetDetail(currentPetId)">Cancel</button>
        </div>
        <p id="editStatus" class="status-msg"></p>
      </div>

      <!-- ADD FEEDING -->
      <div id="tab-feeding-add" style="display:none">
        <h4 style="font-weight:700;color:var(--blue-dark);margin-bottom:1rem">Add Feeding Schedule</h4>
        <div class="form-grid">
          <div class="form-group"><label class="form-label">Meal Time</label><input class="form-input" id="fd-time" type="text" placeholder="e.g. Morning, 7:00 AM"></div>
          <div class="form-group"><label class="form-label">Portion Size</label><input class="form-input" id="fd-portion" type="text" placeholder="e.g. 1.5 cups"></div>
          <div class="form-group"><label class="form-label">Food Type</label><input class="form-input" id="fd-type" type="text" placeholder="e.g. Open Farm Kibble"></div>
          <div class="form-group"><label class="form-label">Notes</label><input class="form-input" id="fd-notes" type="text" placeholder="e.g. Add fish oil supplement"></div>
        </div>
        <div class="form-actions">
          <button class="btn-sm btn-save" onclick="saveFeeding()">&#x1F4BE; Save Meal</button>
          <button class="btn-sm btn-cancel" onclick="showPetDetail(currentPetId)">Cancel</button>
        </div>
        <p id="feedingStatus" class="status-msg"></p>
      </div>

      <!-- ADD GOAL -->
      <div id="tab-goal-add" style="display:none">
        <h4 style="font-weight:700;color:var(--blue-dark);margin-bottom:1rem">Add Training Goal</h4>
        <div class="form-grid">
          <div class="form-group">
            <label class="form-label">Goal Type</label>
            <select class="form-select" id="g-type">
              <option value="training">Training</option>
              <option value="weight">Weight Management</option>
              <option value="health">Health</option>
              <option value="behavior">Behavior</option>
              <option value="general">General</option>
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">Status</label>
            <select class="form-select" id="g-status">
              <option value="active">Active</option>
              <option value="completed">Completed</option>
              <option value="paused">Paused</option>
            </select>
          </div>
          <div class="form-group full"><label class="form-label">Description *</label><input class="form-input" id="g-desc" type="text" placeholder="e.g. Achieve Canine Good Citizen certification"></div>
        </div>
        <div class="form-actions">
          <button class="btn-sm btn-save" onclick="saveGoal()">&#x1F4BE; Save Goal</button>
          <button class="btn-sm btn-cancel" onclick="showPetDetail(currentPetId)">Cancel</button>
        </div>
        <p id="goalStatus" class="status-msg"></p>
      </div>
    </div>
  </div>
</section>

<section class="chat-section" id="chatSection">
  <div class="section-label">// AI Assistant &mdash; Dify + Ollama + MCP Pattern</div>
  <div class="chat-wrapper">
    <div class="chat-header">
      <div class="chat-header-icon">&#x1F916;</div>
      <div class="chat-header-text"><h3>PetHQ AI Assistant</h3><p>ollama.pethq.internal:11434 &middot; tinyllama &middot; MCP context + tools</p></div>
      <span class="chat-dify-badge">DIFY POWERED</span>
    </div>
    <div class="chat-pet-context" id="chatPetContext">&#x1F43E; No pet selected &mdash; select a pet above to personalize responses</div>
    <div class="chat-messages" id="chatMessages">
      <div class="msg ai"><div class="msg-avatar ai">&#x1F43E;</div><div class="msg-bubble">Hi! I'm the PetHQ AI Assistant. Select a pet profile above and I'll use their real data from RDS to give personalized advice!</div></div>
    </div>
    <div class="chat-input-bar">
      <input class="chat-input" id="chatInput" type="text" placeholder="Ask about your pet's care...">
      <button class="chat-send" id="sendBtn">&#10148;</button>
    </div>
    <div class="dify-note">&#x26A1; tinyllama on Ollama EC2 via Dify &middot; MCP context + tools from RDS &middot; Sprint 3</div>
  </div>
</section>

<section class="infra-section" id="infraSection">
  <div class="section-label">// Live AWS Infrastructure Info</div>
  <div class="infra-grid">
    <div class="infra-card"><span class="infra-icon">&#x1F5A5;</span><div class="infra-label">EC2 Hostname</div><div class="infra-value">${info.hostname}</div></div>
    <div class="infra-card"><span class="infra-icon">&#x1F30E;</span><div class="infra-label">AWS Region</div><div class="infra-value">${info.region}</div></div>
    <div class="infra-card"><span class="infra-icon">&#x2B22;</span><div class="infra-label">Node.js</div><div class="infra-value">${info.nodeVersion}</div></div>
    <div class="infra-card"><span class="infra-icon">&#x23F1;</span><div class="infra-label">Uptime</div><div class="infra-value">${info.uptime} min</div></div>
    <div class="infra-card"><span class="infra-icon">&#x1F4BE;</span><div class="infra-label">Memory Used</div><div class="infra-value">${info.memory}%</div><div class="mem-bar"><div class="mem-fill" style="width:${info.memory}%"></div></div></div>
    <div class="infra-card"><span class="infra-icon">&#x1F550;</span><div class="infra-label">Timestamp UTC</div><div class="infra-value" style="font-size:.75rem">${info.timestamp}</div></div>
  </div>
</section>

<footer>
  <div class="footer-left">&copy; 2026 PetHQ &middot; Head in the Clouds &middot; ISQA 8330</div>
  <div class="footer-right">
    <span class="footer-tag">AWS EC2</span><span class="footer-tag">RDS PostgreSQL</span>
    <span class="footer-tag">Dify</span><span class="footer-tag">Ollama</span>
    <span class="footer-tag">tinyllama</span><span class="footer-tag">MCP</span>
  </div>
</footer>

<script>
// Floating paws
const pawBg=document.getElementById('pawBg');
['&#x1F43E;','&#x1F43E;','&#x1F43E;','&#x1F436;','&#x1F431;','&#x1F43E;'].forEach(p=>{
  const el=document.createElement('div');el.className='paw-float';el.innerHTML=p;
  el.style.cssText='font-size:'+(1.2+Math.random()*1.5)+'rem;left:'+Math.random()*100+'vw;animation-duration:'+(18+Math.random()*20)+'s;animation-delay:'+(Math.random()*20)+'s';
  pawBg.appendChild(el);
});

// State
let activePet = null;
let currentPetId = null;
const petCache = {}; // stores pet objects by id — fixes the click issue

// ── Tab Management ──
function showTab(tab) {
  ['list','add','detail','edit','feeding-add','goal-add'].forEach(t => {
    const el = document.getElementById('tab-'+t);
    if(el) el.style.display = 'none';
  });
  const target = document.getElementById('tab-'+tab);
  if(target) target.style.display = 'block';
  document.querySelectorAll('.profile-tab').forEach((t,i) => {
    t.classList.toggle('active', (tab==='list'&&i===0)||(tab==='add'&&i===1));
  });
  if(tab==='list') loadPets();
}

// ── Load Pets ──
async function loadPets() {
  const list = document.getElementById('petList');
  try {
    const res = await fetch('/api/pets');
    const data = await res.json();
    if(data.requiresLogin){
      list.innerHTML='<p style="color:var(--muted);font-size:.85rem">Please <a href="/login" style="color:var(--blue)">sign in</a> to view your pets.</p>';
      return;
    }
    if(!data.pets||data.pets.length===0){
      list.innerHTML='<p style="color:var(--muted);font-size:.85rem">No pets yet. Click &ldquo;+ Add Pet&rdquo; to get started!</p>';
      return;
    }
    // Cache pets by id to avoid JSON serialization issues in onclick
    data.pets.forEach(p => petCache[p.id] = p);
    list.innerHTML = data.pets.map(pet => \`
      <div class="pet-card \${activePet&&activePet.id===pet.id?'selected':''}" data-pet-id="\${pet.id}">
        <div class="pet-card-name">\${pet.name}</div>
        <div class="pet-card-detail">\${pet.species||''}\${pet.breed?' · '+pet.breed:''}</div>
        <div class="pet-card-detail">\${pet.age||''}\${pet.weight?' · '+pet.weight:''}</div>
        \${pet.owner_email ? '<div style="font-size:.68rem;color:#c0550a;margin-top:.2rem">👤 '+pet.owner_email+'</div>' : ''}
        <span class="pet-card-badge">&#x26A1; RDS</span>
      </div>
    \`).join('');
    // Attach click handlers using data attribute — fixes the hover/click issue
    list.querySelectorAll('.pet-card').forEach(card => {
      card.addEventListener('click', () => {
        const id = parseInt(card.getAttribute('data-pet-id'));
        selectPet(id);
      });
    });
  } catch(e){list.innerHTML='<p style="color:#e74c3c;font-size:.85rem">Could not load pets.</p>';}
}

// ── Select Pet (sets active context) ──
function selectPet(petId) {
  const pet = petCache[petId];
  if(!pet) return;
  activePet = pet;
  currentPetId = petId;
  const banner = document.getElementById('activePetBanner');
  banner.style.display='flex';
  document.getElementById('activePetText').innerHTML=\`<strong>\${pet.name}</strong> loaded from RDS — AI will use their profile + MCP tools\`;
  document.getElementById('chatPetContext').innerHTML=\`&#x1F43E; MCP context: <strong>\${pet.name}</strong> &middot; \${pet.species||''}\${pet.breed?' · '+pet.breed:''}\${pet.weight?' · '+pet.weight:''} <span class="mcp-tools-badge">tools: get_pet_profile · get_feeding_schedule · get_medical_records</span>\`;
  showPetDetail(petId);
  addMsg('ai',\`I've loaded \${pet.name}'s profile! Ask me about feeding, health, training goals, or anything pet care related.\`);
  document.getElementById('chatSection').scrollIntoView({behavior:'smooth'});
}

// ── Pet Detail View ──
async function showPetDetail(petId) {
  currentPetId = petId;
  const pet = petCache[petId];
  if(!pet) return;
  showTab('detail');

  // Fetch feeding schedules and goals in parallel
  let feedings = [], goals = [];
  try {
    const [fr, gr] = await Promise.all([
      fetch('/api/feedings?pet_id='+petId).then(r=>r.json()),
      fetch('/api/goals?pet_id='+petId).then(r=>r.json())
    ]);
    feedings = fr.feedings || [];
    goals = gr.goals || [];
  } catch(e){}

  const feedingRows = feedings.length > 0
    ? feedings.map(f=>\`
        <div class="list-item">
          <div class="list-item-main">
            <div class="list-item-title">\${f.meal_time||'Meal'}</div>
            <div class="list-item-sub">\${f.portion_size||''} &middot; \${f.food_type||''}\${f.notes?' &middot; '+f.notes:''}</div>
          </div>
        </div>\`).join('')
    : '<div class="empty-state">No feeding schedule yet.</div>';

  const goalRows = goals.length > 0
    ? goals.map(g=>\`
        <div class="list-item">
          <div class="list-item-main">
            <div class="list-item-title">\${g.description}</div>
            <div class="list-item-sub"><span class="goal-badge">\${g.goal_type}</span> &middot; \${g.status}</div>
          </div>
        </div>\`).join('')
    : '<div class="empty-state">No training goals yet.</div>';

  document.getElementById('detailContent').innerHTML = \`
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:1.2rem;flex-wrap:wrap;gap:.5rem">
      <div>
        <h3 style="font-size:1.4rem;font-weight:900;color:var(--blue-dark)">\${pet.name}</h3>
        <p style="font-family:'DM Mono',monospace;font-size:.72rem;color:var(--muted)">\${pet.species||''}\${pet.breed?' · '+pet.breed:''}</p>
      </div>
      <div style="display:flex;gap:.5rem;flex-wrap:wrap">
        <button class="btn-sm btn-save" onclick="loadEditForm(\${petId})">&#x270F;&#xFE0F; Edit Profile</button>
        <button class="btn-sm btn-cancel" onclick="showTab('list')">&#x2190; Back</button>
      </div>
    </div>

    <div class="detail-view">
      <div class="detail-grid">
        <div class="detail-item"><span class="detail-label">Age</span><span class="detail-value">\${pet.age||'—'}</span></div>
        <div class="detail-item"><span class="detail-label">Weight</span><span class="detail-value">\${pet.weight||'—'}</span></div>
        <div class="detail-item"><span class="detail-label">Food Brand</span><span class="detail-value">\${pet.food_brand||'—'}</span></div>
        <div class="detail-item"><span class="detail-label">Allergies</span><span class="detail-value">\${pet.allergies||'None'}</span></div>
        <div class="detail-item" style="grid-column:1/-1"><span class="detail-label">Medical Notes</span><span class="detail-value">\${pet.medical_notes||'—'}</span></div>
      </div>
    </div>

    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:.75rem">
      <h4 style="font-weight:700;color:var(--blue-dark)">&#x1F37D; Feeding Schedule</h4>
      <button class="btn-sm btn-save" onclick="showTab('feeding-add')" style="font-size:.72rem;padding:.4rem .9rem">+ Add Meal</button>
    </div>
    \${feedingRows}

    <div style="display:flex;align-items:center;justify-content:space-between;margin:.75rem 0;margin-top:1.2rem">
      <h4 style="font-weight:700;color:var(--blue-dark)">&#x1F3AF; Training Goals</h4>
      <button class="btn-sm btn-save" onclick="showTab('goal-add')" style="font-size:.72rem;padding:.4rem .9rem">+ Add Goal</button>
    </div>
    \${goalRows}
  \`;
}

// ── Load Edit Form ──
function loadEditForm(petId) {
  const pet = petCache[petId];
  if(!pet) return;
  document.getElementById('e-name').value = pet.name||'';
  document.getElementById('e-species').value = pet.species||'';
  document.getElementById('e-breed').value = pet.breed||'';
  document.getElementById('e-age').value = pet.age||'';
  document.getElementById('e-weight').value = pet.weight||'';
  document.getElementById('e-food').value = pet.food_brand||'';
  document.getElementById('e-allergies').value = pet.allergies||'';
  document.getElementById('e-medical').value = pet.medical_notes||'';
  showTab('edit');
}

// ── Save New Pet ──
async function savePet() {
  const name = document.getElementById('f-name').value.trim();
  if(!name){document.getElementById('saveStatus').textContent='Pet name is required.';return;}
  document.getElementById('saveStatus').textContent='Saving...';
  try {
    const res = await fetch('/api/pets',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({
      name, species:document.getElementById('f-species').value.trim(),
      breed:document.getElementById('f-breed').value.trim(), age:document.getElementById('f-age').value.trim(),
      weight:document.getElementById('f-weight').value.trim(), food_brand:document.getElementById('f-food').value.trim(),
      allergies:document.getElementById('f-allergies').value.trim(), medical_notes:document.getElementById('f-medical').value.trim()
    })});
    const data = await res.json();
    if(data.pet){
      petCache[data.pet.id] = data.pet;
      document.getElementById('saveStatus').textContent='✅ '+name+' saved!';
      setTimeout(()=>{ showTab('list'); document.getElementById('saveStatus').textContent=''; },1200);
    } else { document.getElementById('saveStatus').textContent='Error saving pet.'; }
  } catch(e){ document.getElementById('saveStatus').textContent='Error connecting to database.'; }
}

// ── Update Pet ──
async function updatePet() {
  const name = document.getElementById('e-name').value.trim();
  if(!name){document.getElementById('editStatus').textContent='Pet name is required.';return;}
  document.getElementById('editStatus').textContent='Saving...';
  try {
    const res = await fetch('/api/pets/'+currentPetId,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({
      name, species:document.getElementById('e-species').value.trim(),
      breed:document.getElementById('e-breed').value.trim(), age:document.getElementById('e-age').value.trim(),
      weight:document.getElementById('e-weight').value.trim(), food_brand:document.getElementById('e-food').value.trim(),
      allergies:document.getElementById('e-allergies').value.trim(), medical_notes:document.getElementById('e-medical').value.trim()
    })});
    const data = await res.json();
    if(data.pet){
      petCache[currentPetId] = data.pet;
      if(activePet&&activePet.id===currentPetId) activePet = data.pet;
      document.getElementById('editStatus').textContent='✅ Updated!';
      setTimeout(()=>{ showPetDetail(currentPetId); },1000);
    } else { document.getElementById('editStatus').textContent='Error updating pet.'; }
  } catch(e){ document.getElementById('editStatus').textContent='Error connecting to database.'; }
}

// ── Save Feeding ──
async function saveFeeding() {
  const mealTime = document.getElementById('fd-time').value.trim();
  if(!mealTime){document.getElementById('feedingStatus').textContent='Meal time is required.';return;}
  document.getElementById('feedingStatus').textContent='Saving...';
  try {
    const res = await fetch('/api/feedings',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({
      pet_id:currentPetId, meal_time:mealTime,
      portion_size:document.getElementById('fd-portion').value.trim(),
      food_type:document.getElementById('fd-type').value.trim(),
      notes:document.getElementById('fd-notes').value.trim()
    })});
    const data = await res.json();
    if(data.feeding){
      document.getElementById('feedingStatus').textContent='✅ Meal saved!';
      // Clear form
      ['fd-time','fd-portion','fd-type','fd-notes'].forEach(id=>document.getElementById(id).value='');
      setTimeout(()=>{ showPetDetail(currentPetId); },1000);
    } else { document.getElementById('feedingStatus').textContent='Error saving meal.'; }
  } catch(e){ document.getElementById('feedingStatus').textContent='Error connecting to database.'; }
}

// ── Save Goal ──
async function saveGoal() {
  const desc = document.getElementById('g-desc').value.trim();
  if(!desc){document.getElementById('goalStatus').textContent='Description is required.';return;}
  document.getElementById('goalStatus').textContent='Saving...';
  try {
    const res = await fetch('/api/goals',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({
      pet_id:currentPetId,
      goal_type:document.getElementById('g-type').value,
      description:desc,
      status:document.getElementById('g-status').value
    })});
    const data = await res.json();
    if(data.goal){
      document.getElementById('goalStatus').textContent='✅ Goal saved!';
      document.getElementById('g-desc').value='';
      setTimeout(()=>{ showPetDetail(currentPetId); },1000);
    } else { document.getElementById('goalStatus').textContent='Error saving goal.'; }
  } catch(e){ document.getElementById('goalStatus').textContent='Error connecting to database.'; }
}

// ── Chat ──
function addMsg(role,text){
  const msgs=document.getElementById('chatMessages');
  const el=document.createElement('div');el.className='msg '+role;
  el.innerHTML='<div class="msg-avatar '+role+'">'+(role==='ai'?'&#x1F43E;':'&#x1F464;')+'</div><div class="msg-bubble">'+text+'</div>';
  msgs.appendChild(el);msgs.scrollTop=msgs.scrollHeight;
}
function addTyping(){
  const msgs=document.getElementById('chatMessages');
  const el=document.createElement('div');el.className='msg ai';el.id='typingIndicator';
  el.innerHTML='<div class="msg-avatar ai">&#x1F43E;</div><div class="msg-typing"><div class="typing-dot"></div><div class="typing-dot"></div><div class="typing-dot"></div></div>';
  msgs.appendChild(el);msgs.scrollTop=msgs.scrollHeight;
}
function removeTyping(){const el=document.getElementById('typingIndicator');if(el)el.remove();}

async function sendMsg(){
  const input=document.getElementById('chatInput');
  const text=input.value.trim();
  if(!text)return;
  input.value='';input.disabled=true;document.getElementById('sendBtn').disabled=true;
  addMsg('user',text);addTyping();
  try {
    const payload={message:text};
    if(activePet) payload.pet_id=activePet.id;
    const res=await fetch('/api/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
    const data=await res.json();
    removeTyping();
    addMsg('ai',data.response||data.error||'Something went wrong.');
  } catch(err){removeTyping();addMsg('ai','Sorry, I could not reach the AI service. Please try again!');}
  input.disabled=false;document.getElementById('sendBtn').disabled=false;input.focus();
}

document.getElementById('sendBtn').addEventListener('click',sendMsg);
document.getElementById('chatInput').addEventListener('keydown',e=>{if(e.key==='Enter')sendMsg();});
loadPets();

// ── Cognito Auth UI ──
async function loadAuthNav() {
  try {
    const res = await fetch('/api/me');
    const data = await res.json();
    const nav = document.getElementById('authNav');
    if (data.user) {
      const isAdmin = data.user.role === 'admin';
      const adminBadge = isAdmin ? '<span style="font-family:monospace;font-size:.65rem;padding:.25rem .6rem;border-radius:100px;background:rgba(255,140,66,.15);color:#c0550a;border:1px solid rgba(255,140,66,.35);margin-right:.25rem">⚡ ADMIN</span>' : '';
      nav.innerHTML = adminBadge + \`
        <span style="font-family:monospace;font-size:.72rem;color:var(--blue-dark);background:rgba(30,144,255,.1);padding:.3rem .75rem;border-radius:100px;border:1px solid rgba(30,144,255,.2)">
          👤 \${data.user.email}
        </span>
        <a href="/logout" style="font-family:monospace;font-size:.72rem;padding:.3rem .75rem;border-radius:100px;background:rgba(231,76,60,.1);color:#c0392b;border:1px solid rgba(231,76,60,.25);text-decoration:none">
          Sign Out
        </a>\`;
    } else {
      nav.innerHTML = \`
        <a href="/login" style="font-family:'DM Mono',monospace;font-size:.72rem;padding:.35rem .9rem;border-radius:100px;background:linear-gradient(135deg,var(--blue),var(--orange));color:white;text-decoration:none;font-weight:700">
          🔐 Sign In
        </a>\`;
    }
  } catch(e) {}
}
loadAuthNav();
</script>
</body>
</html>`;

function parseBody(req) {
  return new Promise((resolve,reject)=>{
    let body='';
    req.on('data',chunk=>body+=chunk);
    req.on('end',()=>{try{resolve(JSON.parse(body));}catch(e){reject(e);}});
  });
}

// URL parser helper
function parseUrl(url) {
  const [path, qs] = url.split('?');
  const params = {};
  if(qs) qs.split('&').forEach(p=>{const[k,v]=p.split('=');params[k]=decodeURIComponent(v||'');});
  return { path, params };
}

const server = http.createServer(async (req, res) => {
  const { path, params } = parseUrl(req.url);

  // ── Cognito Auth Routes ──

  // /login — serve custom login page (direct API flow, no HTTPS redirect needed)
  if (path==='/login' && req.method==='GET') {
    const user = await getSessionUser(req);
    if (user) { res.writeHead(302, { Location: '/' }); res.end(); return; }
    res.writeHead(200, {'Content-Type':'text/html'});
    res.end(`<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>PetHQ — Sign In</title>
<link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;700;900&family=DM+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'DM Sans',sans-serif;background:linear-gradient(135deg,#F4F9FF,#EAF4FF);min-height:100vh;display:flex;align-items:center;justify-content:center}
.card{background:white;border-radius:24px;padding:2.5rem;width:100%;max-width:420px;box-shadow:0 20px 60px rgba(21,101,192,.15)}
.logo{display:flex;align-items:center;gap:.75rem;justify-content:center;margin-bottom:2rem}
.logo-icon{width:48px;height:48px;background:linear-gradient(135deg,#1E90FF,#FF8C42);border-radius:12px;display:flex;align-items:center;justify-content:center;font-size:1.5rem;transform:rotate(-6deg)}
.logo-name{font-size:2rem;font-weight:900;color:#1565C0}
.logo-name span{color:#FFC83D}
h2{text-align:center;color:#1A5276;font-size:1.2rem;font-weight:700;margin-bottom:.5rem}
p{text-align:center;color:#888;font-size:.85rem;margin-bottom:1.5rem;font-family:'DM Mono',monospace}
.form-group{margin-bottom:1rem}
label{display:block;font-family:'DM Mono',monospace;font-size:.68rem;color:#888;text-transform:uppercase;letter-spacing:1px;margin-bottom:.4rem}
input{width:100%;padding:.75rem 1rem;border:1px solid rgba(30,144,255,.25);border-radius:10px;font-family:'DM Sans',sans-serif;font-size:.9rem;outline:none;transition:border-color .2s}
input:focus{border-color:rgba(30,144,255,.65);box-shadow:0 0 0 4px rgba(30,144,255,.1)}
button{width:100%;padding:.85rem;background:linear-gradient(135deg,#1E90FF,#FF8C42);color:white;border:none;border-radius:999px;font-family:'DM Sans',sans-serif;font-size:.95rem;font-weight:800;cursor:pointer;margin-top:.5rem;transition:transform .2s}
button:hover{transform:translateY(-2px)}
.error{background:rgba(231,76,60,.1);color:#c0392b;border:1px solid rgba(231,76,60,.3);border-radius:10px;padding:.75rem 1rem;font-size:.85rem;margin-bottom:1rem;display:none}
.badge{text-align:center;margin-top:1.2rem;font-family:'DM Mono',monospace;font-size:.65rem;color:#aaa}
</style></head>
<body>
<div class="card">
  <div class="logo"><div class="logo-icon">🐾</div><span class="logo-name">Pet<span>HQ</span></span></div>
  <h2>Welcome back</h2>
  <p>Secured by Amazon Cognito + DynamoDB Sessions</p>
  <div class="error" id="errorMsg"></div>
  <div class="form-group"><label>Email</label><input type="email" id="email" placeholder="demo@pethq.com" autocomplete="email"></div>
  <div class="form-group"><label>Password</label><input type="password" id="password" placeholder="••••••••" autocomplete="current-password"></div>
  <button onclick="signIn()">Sign In →</button>
  <div class="badge">🔒 AWS Cognito · DynamoDB Sessions · PetHQ Sprint 3</div>
</div>
<script>
async function signIn() {
  const email = document.getElementById('email').value.trim();
  const password = document.getElementById('password').value;
  const errorEl = document.getElementById('errorMsg');
  errorEl.style.display='none';
  if (!email || !password) { errorEl.textContent='Please enter email and password.'; errorEl.style.display='block'; return; }
  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({email, password})
    });
    const data = await res.json();
    if (data.success) { window.location.href = '/'; }
    else { errorEl.textContent = data.error || 'Invalid email or password.'; errorEl.style.display='block'; }
  } catch(e) { errorEl.textContent = 'Could not reach authentication service.'; errorEl.style.display='block'; }
}
document.addEventListener('keydown', e => { if(e.key==='Enter') signIn(); });
</script>
</body></html>`);
    return;
  }

  // /api/auth/login — direct Cognito authentication using InitiateAuth API
  if (path==='/api/auth/login' && req.method==='POST') {
    try {
      const body = await parseBody(req);
      const { email, password } = body;
      if (!email || !password) {
        res.writeHead(400,{'Content-Type':'application/json'});
        res.end(JSON.stringify({success:false,error:'Email and password required'}));
        return;
      }
      const https = require('https');
      const crypto = require('crypto');
      const secrets = await getSecrets();
      const clientSecret = secrets.cognitoClientSecret;
      const secretHash = crypto.createHmac('sha256', clientSecret)
        .update(email + COGNITO.clientId)
        .digest('base64');
      const authBody = JSON.stringify({
        AuthFlow: 'USER_PASSWORD_AUTH',
        ClientId: COGNITO.clientId,
        AuthParameters: { USERNAME: email, PASSWORD: password, SECRET_HASH: secretHash }
      });
      const authRes = await new Promise((resolve, reject) => {
        const options = {
          hostname: `cognito-idp.${COGNITO.region}.amazonaws.com`,
          path: '/', method: 'POST',
          headers: {
            'Content-Type': 'application/x-amz-json-1.1',
            'X-Amz-Target': 'AWSCognitoIdentityProviderService.InitiateAuth',
            'Content-Length': Buffer.byteLength(authBody)
          }
        };
        const r = https.request(options, resp => { let d=''; resp.on('data',c=>d+=c); resp.on('end',()=>resolve(JSON.parse(d))); });
        r.on('error', reject);
        r.write(authBody); r.end();
      });
      if (authRes.AuthenticationResult) {
        const idToken = authRes.AuthenticationResult.IdToken;
        const payload = JSON.parse(Buffer.from(idToken.split('.')[1], 'base64').toString());

        // Check Cognito group membership for role
        const https2 = require('https');
        const groupBody = JSON.stringify({ AccessToken: authRes.AuthenticationResult.AccessToken });
        const groupRes = await new Promise((resolve, reject) => {
          const options2 = {
            hostname: `cognito-idp.${COGNITO.region}.amazonaws.com`,
            path: '/', method: 'POST',
            headers: {
              'Content-Type': 'application/x-amz-json-1.1',
              'X-Amz-Target': 'AWSCognitoIdentityProviderService.GetUser',
              'Content-Length': Buffer.byteLength(groupBody)
            }
          };
          const r2 = https2.request(options2, resp => { let d=''; resp.on('data',c=>d+=c); resp.on('end',()=>resolve(JSON.parse(d))); });
          r2.on('error', reject);
          r2.write(groupBody); r2.end();
        });

        // Check if user is in admin group via token claims
        const groups = (payload['cognito:groups'] || []);
        const isAdmin = groups.includes('admin');
        const role = isAdmin ? 'admin' : 'user';

        // Look up or create RDS user_id for this Cognito user
        let userId = null;
        try {
          const db = await require('./context').getPool();
          const userResult = await db.query('SELECT id FROM users WHERE email=$1', [payload.email]);
          if (userResult.rows.length > 0) {
            userId = userResult.rows[0].id;
          } else {
            const newUser = await db.query('INSERT INTO users (email, name) VALUES ($1,$2) RETURNING id', [payload.email, payload.email.split('@')[0]]);
            userId = newUser.rows[0].id;
          }
        } catch(dbErr) {
          console.error('RDS user lookup error:', dbErr.message);
        }

        const sessionId = generateSessionId();
        await saveSession(sessionId, { email: payload.email, name: payload.email.split('@')[0], sub: payload.sub, role, userId });
        console.log(`[Auth] User ${payload.email} logged in as ${role} (userId: ${userId})`);
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'Set-Cookie': `pethq_session=${sessionId}; Path=/; HttpOnly; SameSite=Lax`
        });
        res.end(JSON.stringify({ success: true, role }));
      } else if (authRes.ChallengeName === 'NEW_PASSWORD_REQUIRED') {
        res.writeHead(200,{'Content-Type':'application/json'});
        res.end(JSON.stringify({success:false, error:'Password reset required. Please contact admin.'}));
      } else {
        res.writeHead(401,{'Content-Type':'application/json'});
        res.end(JSON.stringify({success:false, error: authRes.message || 'Invalid email or password.'}));
      }
    } catch(err) {
      console.error('Auth error:', err.message);
      res.writeHead(500,{'Content-Type':'application/json'});
      res.end(JSON.stringify({success:false, error:'Authentication service error.'}));
    }
    return;
  }

  // /logout — clear session locally and redirect to home
  if (path==='/logout') {
    await deleteSession(req);
    res.writeHead(302, { 'Set-Cookie': 'pethq_session=; Max-Age=0; Path=/', Location: '/' });
    res.end();
    return;
  }

  // /callback — exchange auth code for tokens
  if (path==='/callback') {
    const code = params.code;
    if (!code) { res.writeHead(302, { Location: '/' }); res.end(); return; }
    try {
      const tokenUrl = `${COGNITO.domain}/oauth2/token`;
      const body = `grant_type=authorization_code&client_id=${COGNITO.clientId}&client_secret=${COGNITO.clientSecret}&code=${code}&redirect_uri=${encodeURIComponent(COGNITO.redirectUri)}`;
      const tokenRes = await new Promise((resolve, reject) => {
        const url = new URL(tokenUrl);
        const options = { hostname: url.hostname, path: url.pathname, method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) } };
        const https = require('https');
        const req2 = https.request(options, r => { let d=''; r.on('data',c=>d+=c); r.on('end',()=>resolve(JSON.parse(d))); });
        req2.on('error', reject);
        req2.write(body); req2.end();
      });
      if (tokenRes.id_token) {
        // Decode JWT payload (no verification needed for demo)
        const payload = JSON.parse(Buffer.from(tokenRes.id_token.split('.')[1], 'base64').toString());
        const sessionId = generateSessionId();
        await saveSession(sessionId, { email: payload.email, name: payload.email.split('@')[0], sub: payload.sub });
        res.writeHead(302, { 'Set-Cookie': `pethq_session=${sessionId}; Path=/; HttpOnly; SameSite=Lax`, Location: '/' });
        res.end();
      } else {
        res.writeHead(302, { Location: '/' }); res.end();
      }
    } catch(err) {
      console.error('Cognito callback error:', err.message);
      res.writeHead(302, { Location: '/' }); res.end();
    }
    return;
  }

  // /api/me — return current user info
  if (path==='/api/me') {
    const user = await getSessionUser(req);
    res.writeHead(200, {'Content-Type':'application/json'});
    res.end(JSON.stringify({ user: user || null }));
    return;
  }

  if (path==='/health') { res.writeHead(200,{'Content-Type':'text/plain'});res.end('healthy');return; }
  if (path==='/api/status') { res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({status:'ok',...getServerInfo()}));return; }

  // GET /api/pets — admins see all pets, regular users see only their own
  if (path==='/api/pets' && req.method==='GET') {
    try {
      const user = await getSessionUser(req);
      let result;
      if (user && user.role === 'admin') {
        // Admin sees all pets with owner email
        result = await pool.query(`
          SELECT p.*, u.email as owner_email 
          FROM pets p 
          LEFT JOIN users u ON u.id = p.user_id 
          ORDER BY p.created_at DESC
        `);
        console.log(`[Auth] Admin ${user.email} fetching all pets`);
      } else if (user && user.userId) {
        // Regular user sees only their pets
        result = await pool.query('SELECT * FROM pets WHERE user_id=$1 ORDER BY created_at DESC', [user.userId]);
        console.log(`[Auth] User ${user.email} fetching their pets (user_id: ${user.userId})`);
      } else {
        // Not logged in — return empty
        res.writeHead(200,{'Content-Type':'application/json'});
        res.end(JSON.stringify({pets:[], requiresLogin: true}));
        return;
      }
      res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({pets:result.rows}));
    } catch(err){res.writeHead(500,{'Content-Type':'application/json'});res.end(JSON.stringify({error:err.message}));}
    return;
  }

  // POST /api/pets
  if (path==='/api/pets' && req.method==='POST') {
    try {
      const b=await parseBody(req);
      if(!b.name){res.writeHead(400,{'Content-Type':'application/json'});res.end(JSON.stringify({error:'Pet name required'}));return;}
      const result=await pool.query(
        'INSERT INTO pets (user_id,name,species,breed,age,weight,allergies,food_brand,medical_notes) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *',
        [1,b.name,b.species||null,b.breed||null,b.age||null,b.weight||null,b.allergies||null,b.food_brand||null,b.medical_notes||null]
      );
      res.writeHead(201,{'Content-Type':'application/json'});res.end(JSON.stringify({pet:result.rows[0]}));
    } catch(err){res.writeHead(500,{'Content-Type':'application/json'});res.end(JSON.stringify({error:err.message}));}
    return;
  }

  // PUT /api/pets/:id
  const petEditMatch = path.match(/^\/api\/pets\/(\d+)$/);
  if (petEditMatch && req.method==='PUT') {
    try {
      const id=parseInt(petEditMatch[1]);
      const b=await parseBody(req);
      if(!b.name){res.writeHead(400,{'Content-Type':'application/json'});res.end(JSON.stringify({error:'Pet name required'}));return;}
      const result=await pool.query(
        'UPDATE pets SET name=$1,species=$2,breed=$3,age=$4,weight=$5,allergies=$6,food_brand=$7,medical_notes=$8 WHERE id=$9 RETURNING *',
        [b.name,b.species||null,b.breed||null,b.age||null,b.weight||null,b.allergies||null,b.food_brand||null,b.medical_notes||null,id]
      );
      res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({pet:result.rows[0]}));
    } catch(err){res.writeHead(500,{'Content-Type':'application/json'});res.end(JSON.stringify({error:err.message}));}
    return;
  }

  // GET /api/feedings?pet_id=X
  if (path==='/api/feedings' && req.method==='GET') {
    try {
      const result=await pool.query('SELECT * FROM feeding_schedules WHERE pet_id=$1 ORDER BY id',[params.pet_id]);
      res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({feedings:result.rows}));
    } catch(err){res.writeHead(500,{'Content-Type':'application/json'});res.end(JSON.stringify({error:err.message}));}
    return;
  }

  // POST /api/feedings
  if (path==='/api/feedings' && req.method==='POST') {
    try {
      const b=await parseBody(req);
      const result=await pool.query(
        'INSERT INTO feeding_schedules (pet_id,meal_time,portion_size,food_type,notes) VALUES ($1,$2,$3,$4,$5) RETURNING *',
        [b.pet_id,b.meal_time||null,b.portion_size||null,b.food_type||null,b.notes||null]
      );
      res.writeHead(201,{'Content-Type':'application/json'});res.end(JSON.stringify({feeding:result.rows[0]}));
    } catch(err){res.writeHead(500,{'Content-Type':'application/json'});res.end(JSON.stringify({error:err.message}));}
    return;
  }

  // GET /api/goals?pet_id=X
  if (path==='/api/goals' && req.method==='GET') {
    try {
      const result=await pool.query('SELECT * FROM pet_goals WHERE pet_id=$1 ORDER BY created_at DESC',[params.pet_id]);
      res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({goals:result.rows}));
    } catch(err){res.writeHead(500,{'Content-Type':'application/json'});res.end(JSON.stringify({error:err.message}));}
    return;
  }

  // POST /api/goals
  if (path==='/api/goals' && req.method==='POST') {
    try {
      const b=await parseBody(req);
      if(!b.description){res.writeHead(400,{'Content-Type':'application/json'});res.end(JSON.stringify({error:'Description required'}));return;}
      const result=await pool.query(
        'INSERT INTO pet_goals (pet_id,goal_type,description,status) VALUES ($1,$2,$3,$4) RETURNING *',
        [b.pet_id,b.goal_type||'general',b.description,b.status||'active']
      );
      res.writeHead(201,{'Content-Type':'application/json'});res.end(JSON.stringify({goal:result.rows[0]}));
    } catch(err){res.writeHead(500,{'Content-Type':'application/json'});res.end(JSON.stringify({error:err.message}));}
    return;
  }

  // POST /api/chat — MCP Orchestration
  if (path==='/api/chat' && req.method==='POST') {
    try {
      const body=await parseBody(req);
      const {message,pet_id}=body;
      const context=await buildContext(message,pet_id||null);
      const toolResults=await invokeTools(message,pet_id||null);

      let contextSummary='';
      if(context.pet){
        contextSummary+=`Pet: ${context.pet.name}, ${context.pet.species}, ${context.pet.breed}, ${context.pet.ageYears}, ${context.pet.weightLbs}.`;
        if(context.pet.allergies) contextSummary+=` Allergies: ${context.pet.allergies}.`;
        if(context.pet.foodBrand) contextSummary+=` Food: ${context.pet.foodBrand}.`;
      }
      for(const tr of toolResults){
        if(tr.tool==='get_feeding_schedule'&&tr.result.meals){
          contextSummary+=` Feeding: ${tr.result.meals.map(m=>`${m.mealTime}: ${m.portionSize} ${m.foodType}`).join(', ')}.`;
        }
        if(tr.tool==='get_medical_records') contextSummary+=` Medical: ${tr.result.medicalNotes}.`;
        if(tr.tool==='get_training_goals'&&tr.result.goals){ contextSummary+=` Training goals: ${tr.result.goals.map(g=>g.description).join('; ')}.`; }
      }

      const toolsInvoked=toolResults.map(t=>t.tool).join(', ')||'none';
      console.log(`[MCP Orchestrator] Tools invoked: ${toolsInvoked}`);

      const difyBody=JSON.stringify({
        inputs:{
          pet_name:context.pet?context.pet.name:'',
          species:context.pet?context.pet.species:'',
          breed:context.pet?context.pet.breed:'',
          age:context.pet?context.pet.ageYears:'',
          weight:context.pet?context.pet.weightLbs:'',
          allergies:context.pet?context.pet.allergies:''
        },
        query:contextSummary?`[Context: ${contextSummary}] ${message}`:message,
        response_mode:'streaming',user:'pethq-user'
      });

      const options={hostname:'10.0.129.128',port:80,path:'/v1/chat-messages',method:'POST',
        headers:{'Content-Type':'application/json','Authorization':`Bearer ${DIFY_API_KEY}`,'Content-Length':Buffer.byteLength(difyBody)}};

      let answer='',responded=false;
      const difyReq=http.request(options,(difyRes)=>{
        difyRes.on('data',chunk=>{
          chunk.toString().split('\n').forEach(line=>{
            if(line.startsWith('data: ')){
              try{
                const p=JSON.parse(line.slice(6));
                if(p.event==='message'&&p.answer) answer+=p.answer;
                if(p.event==='workflow_finished'&&!responded){
                  responded=true;
                  const out=p.data&&p.data.outputs&&p.data.outputs.text;
                  difyRes.destroy();
                  res.writeHead(200,{'Content-Type':'application/json'});
                  res.end(JSON.stringify({response:out||answer||'No response from AI.',tools_invoked:toolsInvoked}));
                }
              }catch(e){}
            }
          });
        });
        difyRes.on('end',()=>{
          if(!responded){responded=true;res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({response:answer||'No response.',tools_invoked:toolsInvoked}));}
        });
      });
      difyReq.on('error',()=>{if(!responded){responded=true;res.writeHead(500,{'Content-Type':'application/json'});res.end(JSON.stringify({error:'AI service unavailable.'}));}});
      difyReq.setTimeout(180000,()=>{difyReq.destroy();if(!responded){responded=true;res.writeHead(500,{'Content-Type':'application/json'});res.end(JSON.stringify({error:'AI took too long.'}));}});
      difyReq.write(difyBody);difyReq.end();
    } catch(err){res.writeHead(400,{'Content-Type':'application/json'});res.end(JSON.stringify({error:'Invalid request.'}));}
    return;
  }

  res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});
  res.end(buildHtml(getServerInfo()));
});

// Initialize secrets then start server
getSecrets().then(secrets => {
  pool = new Pool({
    host: secrets.rds.host,
    port: secrets.rds.port,
    database: secrets.rds.database,
    user: secrets.rds.user,
    password: secrets.rds.password,
    ssl: { rejectUnauthorized: false },
    max: 10, idleTimeoutMillis: 30000, connectionTimeoutMillis: 5000,
  });
  DIFY_API_KEY = secrets.difyApiKey;
  COGNITO.clientSecret = secrets.cognitoClientSecret; 
  server.listen(3001, () => { console.log('PetHQ v1.3.0 Sprint 3 running on port 3001'); });
}).catch(err => {
  console.error('Failed to initialize secrets:', err);
  process.exit(1);
});
