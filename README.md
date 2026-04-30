# PetHQ — AI-Powered Pet Care Platform with MCP Orchestration

An enterprise-grade pet care platform built on AWS with self-hosted AI and MCP (Model Context Protocol) orchestration. Originally built as a final project for ISQA 8330 (Cloud Infrastructure), this repository includes both the full enterprise architecture and a streamlined portfolio deployment.

## Live Demo

**Portfolio version:** `http://<your-elastic-ip>`

## What is PetHQ?

PetHQ is a web application that lets pet owners manage profiles, feeding schedules, medical records, and training goals — with an AI assistant that gives personalized advice grounded in the pet's real data. The AI doesn't hallucinate generic responses; it queries the database for your specific pet's profile, feeding schedule, and goals before generating an answer.

## MCP Orchestration Pattern

The core of this project is the **Model Context Protocol** implementation, which separates AI interactions into three layers:

```
User Question
    │
    ▼
┌──────────────┐
│  server.js   │  ← Orchestrator: receives request, coordinates the flow
│              │
│  1. context  │  → context.js builds structured JSON from RDS
│  2. tools    │  → tools.js keyword-matches and pre-fetches data
│  3. prompt   │  → Composes grounded prompt with real pet data
│  4. model    │  → Sends to Ollama (tinyllama)
│  5. respond  │  → Returns AI response to user
└──────────────┘
```

**context.js** (Data Layer) — Queries PostgreSQL for pet profiles, active goals, and user preferences. Returns a structured JSON context bundle with request metadata, user info, and pet data.

**tools.js** (Tools Layer) — Defines available tools (`get_pet_profile`, `get_feeding_schedule`, `get_medical_records`, `get_training_goals`, `log_event`) and invokes them in parallel based on keyword detection in the user's message. For example, asking "what should I feed Peanut?" triggers `get_feeding_schedule`, while "how's training going?" triggers `get_training_goals`.

**server.js** (Orchestrator) — Coordinates the full flow: calls context.js to build the data bundle, calls tools.js to pre-fetch relevant tool outputs, composes a grounded prompt combining everything, and sends it to Ollama for inference.

This pattern ensures the AI's responses are always grounded in actual database records rather than generic knowledge.

## Architecture

### Enterprise Version (ISQA 8330 Course Project)

The full system deployed during the course used a multi-tier architecture across 3 EC2 instances:

```
Internet → ALB (port 80)
              │
    ┌─────────┴─────────┐
    ▼                   ▼
┌─────────┐       ┌─────────┐
│ App EC2 │       │ App EC2 │   ← 2x t2.micro in private subnets (AZ1 + AZ2)
│ (AZ1)   │       │ (AZ2)   │      Node.js + nginx + MCP orchestration
└────┬────┘       └────┬────┘
     │                 │
     ▼                 ▼
┌────────────────────────────┐
│      Ollama EC2 (AZ1)      │   ← 1x t3.large in private subnet
│  Ollama + Dify + Docker    │      tinyllama model, Dify chatflow
└────────────────────────────┘
     │
     ▼
┌────────────────────────────┐
│   RDS PostgreSQL (AZ1)     │   ← db.t3.micro in isolated DB subnet
│   Pets, feeding, goals     │
└────────────────────────────┘
```

**Additional enterprise features built but removed from portfolio version:**

- **AWS Cognito** — OAuth authentication with USER_PASSWORD_AUTH flow, admin/user role separation via Cognito groups, JWT decode, and custom login page
- **DynamoDB Sessions** — Session store with TTL for stateless multi-instance auth; sessions persisted across both App EC2s
- **Dify** — Open-source LLM orchestration platform running as Docker containers on the Ollama EC2, providing a chatflow UI and API layer
- **NAT Gateway** — Enabled private subnet EC2s to reach the internet for package installs and Session Manager
- **Application Load Balancer** — Distributed traffic across both App EC2s with health checks
- **CloudFormation IaC** — Two-stack design: permanent stack (VPC, EC2s, RDS, S3, DynamoDB) deployed once, per-session stack (NAT, ALB, EIP) deployed/destroyed each working session to minimize cost
- **S3 Code Deployment** — App files (server.js, context.js, tools.js) uploaded to S3 and pulled to EC2 instances each session
- **AWS Secrets Manager** — Three secrets (pethq/rds, pethq/dify, pethq/cognito1) fetched via CLI at app startup

See `aws-original/` for the full implementation of all these features.

### Portfolio Version (This Deployment)

Simplified for always-on hosting at minimal cost:

```
Internet → Elastic IP → nginx (:80) → Node.js (:3001)
                                           │
                              ┌────────────┤
                              ▼            ▼
                        Ollama         RDS PostgreSQL
                      (localhost       (private subnet)
                       :11434)
```

One EC2 runs everything (Node.js + Ollama), with RDS in a private subnet. No ALB, no NAT Gateway, no Dify. The MCP orchestration layer is identical.

## Repository Structure

```
pethq/
├── app/                          # Portfolio version application code
│   ├── server.js                 # MCP Orchestrator (calls Ollama directly)
│   ├── context.js                # MCP Context Builder (unchanged)
│   ├── tools.js                  # MCP Tools Layer (unchanged)
│   ├── secrets.js                # dotenv-based config
│   ├── package.json
│   └── .env.example
│
├── aws-portfolio/
│   └── pethq-portfolio-stack.yaml  # Single CloudFormation template
│
├── aws-original/                 # Full enterprise version (ISQA 8330)
│   ├── server.js                 # v1.3.0 with Cognito + DynamoDB + Dify
│   ├── context.js
│   ├── tools.js
│   ├── secrets.js                # AWS Secrets Manager integration
│   ├── nginx.conf                # Dify + app proxy routes
│   ├── pethq-permanent-infrastructure.yaml   # 617-line permanent stack
│   └── pethq-per-session.yaml                # Per-session ALB + NAT stack
│
├── db/
│   └── schema.sql                # Tables + seed data
│
├── docs/
│   └── (architecture diagrams, screenshots)
│
└── README.md
```

## Tech Stack

| Layer | Enterprise Version | Portfolio Version |
|-------|-------------------|-------------------|
| Compute | 3x EC2 (2x t2.micro + 1x t3.large) | 1x EC2 (t3.small) |
| Load Balancing | Application Load Balancer | Elastic IP + nginx |
| AI Model | Ollama → Dify → tinyllama | Ollama → tinyllama (direct) |
| Database | RDS PostgreSQL (db.t3.micro) | RDS PostgreSQL (db.t3.micro) |
| Auth | AWS Cognito + DynamoDB sessions | None (portfolio demo) |
| Secrets | AWS Secrets Manager | dotenv |
| IaC | 2 CloudFormation stacks | 1 CloudFormation stack |
| Networking | VPC, 6 subnets, NAT Gateway, 4 SGs | VPC, 4 subnets, 2 SGs |

## Deployment

### Prerequisites

- AWS account with CloudFormation access
- AWS CLI configured
- EC2 key pair (optional, for SSH)

### Steps

1. **Deploy the stack:**
   ```bash
   aws cloudformation create-stack \
     --stack-name pethq-portfolio \
     --template-body file://aws-portfolio/pethq-portfolio-stack.yaml \
     --parameters ParameterKey=DBPassword,ParameterValue=<your-password>
   ```

2. **Wait for stack completion** (~10 minutes for RDS):
   ```bash
   aws cloudformation wait stack-create-complete --stack-name pethq-portfolio
   ```

3. **Deploy app files** to the EC2:
   ```bash
   scp -i your-key.pem app/* ec2-user@<elastic-ip>:/opt/pethq/
   ```

4. **Install dependencies and load schema:**
   ```bash
   ssh -i your-key.pem ec2-user@<elastic-ip>
   cd /opt/pethq && npm install
   psql -h <rds-endpoint> -U postgres -d pethq -f /opt/pethq/../db/schema.sql
   sudo systemctl start pethq
   ```

5. **Access PetHQ** at `http://<elastic-ip>`

## Cost

| Resource | Monthly Cost |
|----------|-------------|
| EC2 t3.small | ~$15 (or free tier with t3.micro) |
| RDS db.t3.micro | ~$13 (or free tier eligible) |
| Elastic IP | $0 (attached to running instance) |
| **Total** | **$0–28/month** |

## Team

**Group 1 — Head in the Clouds** | ISQA 8330 Spring 2026

- **Trisha** — Web application, REST APIs, MCP orchestration
- **Duffy** — Infrastructure, CloudFormation, final integration
- **Ivy** — Ollama setup, AI service integration

## License

MIT
