# Prompts

System prompts for Choraleia's multi-agent architecture.

## Files

```
prompts/
├── README.md               # This file
└── fullstack/              # Full Stack Team prompts
    ├── supervisor.md       # Tech Lead / Team coordinator
    ├── coding.md           # General coding agent (fallback)
    ├── frontend.md         # Frontend developer
    ├── backend.md          # Backend developer
    ├── devops.md           # DevOps engineer
    ├── database.md         # Database administrator
    ├── security.md         # Security engineer
    ├── technical_writer.md # Documentation specialist
    ├── code_reviewer.md    # Code reviewer
    └── qa_engineer.md      # QA/Test engineer
```

## Architecture

```
                         User Request
                              │
                              ▼
                    ┌─────────────────┐
                    │   Supervisor    │  Tech Lead
                    │   (Coordinator) │
                    └────────┬────���───┘
                             │ transfer_to_agent()
         ┌───────────────────��───────────────────┐
         │         │         │         │         │
         ▼         ▼         ▼         ▼         ▼
    ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐
    │Frontend │ │Backend  │ │ DevOps  │ │Database │ │Security │ ...
    │  Agent  │ │  Agent  │ │  Agent  │ │  Agent  │ │  Agent  │
    └─────────┘ └─────────┘ └─────────┘ └─────────┘ └─────────┘
```

## Agent Configurations

### Supervisor (Tech Lead)

| Field | Value |
|-------|-------|
| **Name** | `supervisor` |
| **Type** | `supervisor` |
| **Description** | `Tech Lead who coordinates the engineering team and delegates tasks to specialists` |
| **Instruction** | Content of `supervisor.md` |

### Sub-Agents

| Name | Type | Description |
|------|------|-------------|
| `frontend_agent` | `chat_model` | `Senior Frontend Developer: React, Vue, CSS, Tailwind, state management, UI components, frontend build tools` |
| `backend_agent` | `chat_model` | `Senior Backend Developer: Go, Python, Node.js APIs, databases, microservices, REST/GraphQL` |
| `devops_agent` | `chat_model` | `Senior DevOps Engineer: Docker, Kubernetes, CI/CD, Terraform, cloud infrastructure, monitoring` |
| `database_agent` | `chat_model` | `Senior DBA: PostgreSQL, MySQL, MongoDB, Redis, schema design, query optimization, migrations` |
| `security_agent` | `chat_model` | `Senior Security Engineer: authentication, OWASP, secure coding, penetration testing, compliance` |
| `docs_agent` | `chat_model` | `Senior Technical Writer: documentation, README, API docs, tutorials, architecture diagrams` |
| `reviewer_agent` | `chat_model` | `Senior Code Reviewer: code quality, best practices, design patterns, refactoring suggestions` |
| `qa_agent` | `chat_model` | `Senior QA Engineer: unit tests, E2E tests, test automation, performance testing, Playwright, Jest` |
| `coding_agent` | `chat_model` | `Full Stack Developer: general programming, mixed tasks, fallback for unspecified work` |

## ⚠️ Important: Description Field

The **Description** field is critical! Eino ADK injects it into supervisor's context:

```
Available other agents:
- Agent name: frontend_agent
  Agent description: Senior Frontend Developer: React, Vue, CSS...
- Agent name: backend_agent
  Agent description: Senior Backend Developer: Go, Python...
...

Decision rule:
- If you're best suited: ANSWER
- If another agent is better: CALL 'transfer_to_agent' with their name
```

**Without clear descriptions, the supervisor won't know which agent to choose!**

## Quick Setup

### Option 1: Full Team (All Agents)

Connect all agents to supervisor:
```
[Start] → [Supervisor] → [frontend_agent]
                      → [backend_agent]
                      → [devops_agent]
                      → [database_agent]
                      → [security_agent]
                      → [docs_agent]
                      → [reviewer_agent]
                      → [qa_agent]
                      → [coding_agent]
```

### Option 2: Minimal (Single Coding Agent)

For simpler setup:
```
[Start] → [Supervisor] → [coding_agent]
```

### Option 3: No Supervisor (Direct Agent)

Skip supervisor, use coding_agent directly:
```
[Start] → [coding_agent]
```

## Tool Assignment

| Agent | Recommended Tools |
|-------|-------------------|
| `frontend_agent` | workspace_fs_*, workspace_exec_* |
| `backend_agent` | workspace_fs_*, workspace_exec_*, mysql_*, postgres_*, redis_* |
| `devops_agent` | workspace_fs_*, workspace_exec_*, asset_*, transfer_* |
| `database_agent` | mysql_*, postgres_*, redis_*, workspace_fs_read |
| `security_agent` | workspace_fs_*, workspace_exec_* |
| `docs_agent` | workspace_fs_* |
| `reviewer_agent` | workspace_fs_read, workspace_repomap, workspace_search_symbol |
| `qa_agent` | workspace_fs_*, workspace_exec_* |
| `coding_agent` | ALL tools |
