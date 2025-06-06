# AI Agent Platform

A modern web application platform for AI agents with robust authentication, real-time capabilities, and scalable architecture.

## 🏗️ Architecture

The platform consists of three main components:

- **Frontend**: Modern Vue.js application with Tailwind CSS
- **Backend**: Node.js/Express REST API with PostgreSQL and Redis
- **Nginx**: Reverse proxy and static file server

```
├── frontend/          # Vue.js frontend application
├── backend/          # Express.js backend API
├── deployment/       # Docker and deployment configurations
└── agent/           # AI agent implementation
```

## 🚀 Key Features

- Secure JWT-based authentication system
- Real-time communication using Socket.IO
- PostgreSQL database with migrations
- Redis for caching and session management
- Docker containerization
- Nginx reverse proxy configuration
- Comprehensive error handling and logging
- Rate limiting and security middleware
- Modern UI with Tailwind CSS

## 🛠️ Technology Stack

### Backend
- Node.js & Express
- PostgreSQL with node-pg-migrate
- Redis
- JWT authentication
- Socket.IO
- Winston logger

### Frontend
- Vue.js
- Tailwind CSS
- Vuex for state management
- Vue Router
- Axios for API calls

### DevOps
- Docker & Docker Compose
- Nginx
- GitHub Actions (CI/CD)

## 🔧 Setup & Installation

1. Clone the repository:
\`\`\`bash
git clone <repository-url>
cd ai-agent-platform
\`\`\`

2. Set up environment variables:
\`\`\`bash
# Backend (.env)
PORT=3000
NODE_ENV=development
DB_PASSWORD=your_password
JWT_SECRET=your_secret
AI_API_KEY=your_api_key

# Frontend (.env)
VUE_APP_API_URL=http://localhost:3000
\`\`\`

3. Start the development environment:
\`\`\`bash
# Using Docker
docker-compose up -d

# Manual Setup
# Backend
cd backend
npm install
npm run migrate up
npm run dev

# Frontend
cd frontend
npm install
npm run dev
\`\`\`

## 📝 Development

### Backend Development

- Run migrations:
\`\`\`bash
cd backend
npm run migrate up
\`\`\`

- Start development server:
\`\`\`bash
npm run dev
\`\`\`

### Frontend Development

- Start development server:
\`\`\`bash
cd frontend
npm run dev
\`\`\`

## 🔒 Security Features

- JWT-based authentication
- Password hashing with bcrypt
- Rate limiting
- CORS protection
- Helmet security headers
- SQL injection prevention
- XSS protection
- CSRF protection

## 🚦 API Routes

### Authentication
- POST /api/auth/register - Register new user
- POST /api/auth/login - User login
- POST /api/auth/refresh - Refresh access token
- POST /api/auth/logout - User logout

### User Management
- GET /api/users/profile - Get user profile
- PUT /api/users/profile - Update user profile
- PUT /api/users/password - Change password

## 📦 Deployment

1. Build the images:
\`\`\`bash
docker-compose build
\`\`\`

2. Start the services:
\`\`\`bash
docker-compose up -d
\`\`\`

3. Initialize the database:
\`\`\`bash
docker-compose exec backend npm run migrate up
\`\`\`

## 🧪 Testing

- Run backend tests:
\`\`\`bash
cd backend
npm test
\`\`\`

- Run frontend tests:
\`\`\`bash
cd frontend
npm test
\`\`\`

## 📈 Monitoring

The application includes:
- Winston logging
- Error tracking
- Performance monitoring
- Rate limiting metrics

## 🤝 Contributing

1. Fork the repository
2. Create your feature branch
3. Commit your changes
4. Push to the branch
5. Create a Pull Request

## 📄 License

This project is licensed under the MIT License - see the LICENSE file for details.
