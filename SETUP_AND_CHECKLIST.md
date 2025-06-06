# Project Setup and Verification Checklist

## 🔍 Pre-Installation Checklist

### System Requirements
- [ ] Node.js v14+ installed
- [ ] PostgreSQL 14+ installed
- [ ] Redis installed
- [ ] Docker and Docker Compose installed
- [ ] Git installed

### Environment Setup
- [ ] Clone repository
- [ ] Copy .env.example files to .env in both frontend and backend directories
- [ ] Configure environment variables
- [ ] Set up SSL certificates (if needed)

## 📋 Installation Steps

1. **Clone and Setup Repository**
\`\`\`bash
# Clone the repository
git clone https://github.com/Iscgrou/agent.git
cd agent

# Make setup script executable
chmod +x setup.sh

# Run setup script
./setup.sh
\`\`\`

2. **Configure Environment Variables**
\`\`\`bash
# Backend (.env)
PORT=3000
NODE_ENV=development
DB_HOST=postgres
DB_PORT=5432
DB_NAME=aiagent_db
DB_USER=aiagent
DB_PASSWORD=secure_password
REDIS_HOST=redis
REDIS_PORT=6379
JWT_SECRET=your_secret_key_here

# Frontend (.env)
VUE_APP_API_URL=http://localhost:3000
VUE_APP_WS_URL=ws://localhost:3000
\`\`\`

3. **Install Dependencies**
\`\`\`bash
# Install backend dependencies
cd backend
npm install

# Install frontend dependencies
cd ../frontend
npm install
\`\`\`

4. **Database Setup**
\`\`\`bash
# Run migrations
cd ../backend
npm run migrate up
\`\`\`

5. **Start Services**
\`\`\`bash
# Using Docker
docker-compose up -d

# Manual Start
# Terminal 1 - Backend
cd backend
npm run dev

# Terminal 2 - Frontend
cd frontend
npm run dev
\`\`\`

## 🔎 Verification Checklist

### Backend Services
- [ ] Database Connection
  - [ ] Run \`npm run migrate status\` to verify migrations
  - [ ] Check database tables exist
  - [ ] Verify indexes are created

- [ ] Redis Connection
  - [ ] Test session storage
  - [ ] Verify caching functionality

- [ ] API Endpoints
  - [ ] Test authentication endpoints
  - [ ] Verify user management routes
  - [ ] Check settings endpoints
  - [ ] Test Vertex AI integration

### Frontend Components
- [ ] Authentication
  - [ ] Test login functionality
  - [ ] Test registration
  - [ ] Verify token management
  - [ ] Check password reset flow

- [ ] Dashboard
  - [ ] Verify stats display
  - [ ] Test project creation
  - [ ] Check system status indicators
  - [ ] Verify real-time updates

- [ ] Settings
  - [ ] Test Vertex AI key management
  - [ ] Verify API connection testing
  - [ ] Check admin-only access
  - [ ] Test settings persistence

### Security
- [ ] JWT Implementation
  - [ ] Token expiration
  - [ ] Refresh token rotation
  - [ ] Secure storage

- [ ] API Security
  - [ ] Rate limiting
  - [ ] CORS configuration
  - [ ] Input validation
  - [ ] XSS protection

- [ ] Database Security
  - [ ] Connection encryption
  - [ ] Password hashing
  - [ ] SQL injection prevention

### Performance
- [ ] Backend
  - [ ] Response times < 200ms
  - [ ] Memory usage stable
  - [ ] Connection pooling configured
  - [ ] Error handling working

- [ ] Frontend
  - [ ] Page load time < 2s
  - [ ] Smooth animations
  - [ ] No memory leaks
  - [ ] Error boundaries working

## 🔧 Vertex AI Setup

1. **Get API Key**
   - [ ] Go to Google Cloud Console
   - [ ] Navigate to APIs & Services > Credentials
   - [ ] Create new API key
   - [ ] Add API restrictions

2. **Configure in Dashboard**
   - [ ] Log in as admin
   - [ ] Navigate to Settings
   - [ ] Enter Vertex AI API key
   - [ ] Test connection

3. **Verify Integration**
   - [ ] Check API connection
   - [ ] Test model availability
   - [ ] Verify error handling
   - [ ] Monitor usage metrics

## 📝 Post-Installation Tasks

1. **Create Admin User**
\`\`\`bash
# Using provided script
npm run create-admin
\`\`\`

2. **Verify Logging**
- [ ] Check log files are being created
- [ ] Verify log rotation
- [ ] Monitor error logging

3. **Backup Configuration**
- [ ] Set up database backups
- [ ] Configure log backups
- [ ] Document recovery procedures

4. **Documentation**
- [ ] Update API documentation
- [ ] Document custom configurations
- [ ] Update deployment guides

## 🚨 Common Issues and Solutions

### Database Connection Issues
```bash
# Check database status
docker-compose ps postgres

# View logs
docker-compose logs postgres
```

### Redis Connection Issues
```bash
# Check Redis status
docker-compose ps redis

# Test Redis connection
redis-cli ping
```

### API Connection Issues
```bash
# Check API status
curl http://localhost:3000/api/health

# View API logs
docker-compose logs backend
```

### Frontend Build Issues
```bash
# Clear cache and node_modules
rm -rf node_modules
rm -rf .cache
npm install
```

## 🔄 Update Procedures

1. **Update Dependencies**
```bash
# Update backend
cd backend
npm update

# Update frontend
cd frontend
npm update
```

2. **Database Updates**
```bash
# Run new migrations
npm run migrate up
```

3. **Cache Clear**
```bash
# Clear Redis cache
redis-cli flushall
```

## 📞 Support Contacts

- Technical Issues: [tech-support@example.com]
- Security Issues: [security@example.com]
- API Integration: [api-support@example.com]

## 🔍 Monitoring Setup

1. **Configure Monitoring Tools**
- [ ] Set up logging aggregation
- [ ] Configure performance monitoring
- [ ] Set up error tracking
- [ ] Enable security monitoring

2. **Set Up Alerts**
- [ ] Configure system health alerts
- [ ] Set up security breach notifications
- [ ] Enable performance degradation alerts
- [ ] Configure database monitoring alerts
