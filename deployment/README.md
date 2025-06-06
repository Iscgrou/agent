# AI Agent Platform Deployment Guide

## Infrastructure Setup (Ubuntu 22.04 VPS)

### Prerequisites
- Ubuntu 22.04 VPS
- Domain name pointed to your VPS
- SSH access to your VPS

### Initial Setup
1. Clone this repository to your local machine
2. Copy the deployment files to your VPS:
   ```bash
   scp -r deployment/ user@your-vps-ip:~/ai-agent-platform/
   ```

3. SSH into your VPS and run the setup script:
   ```bash
   ssh user@your-vps-ip
   cd ~/ai-agent-platform
   chmod +x deployment/scripts/setup-ubuntu.sh
   ./deployment/scripts/setup-ubuntu.sh
   ```

4. Configure SSL certificates:
   ```bash
   sudo certbot --nginx -d your-domain.com
   ```

### Docker Deployment
1. Update environment variables:
   - Copy `.env.example` to `.env`
   - Update the variables with your configuration

2. Start the services:
   ```bash
   docker-compose up -d
   ```

3. Verify the deployment:
   ```bash
   docker-compose ps
   ```

### Security Checklist
- [x] System updates and security patches
- [x] Firewall configuration (UFW)
- [x] Fail2ban installation
- [x] SSL/TLS configuration
- [x] Secure Docker configuration
- [x] Automatic security updates
- [x] Swap space configuration
- [x] System optimization

### Monitoring
Monitor the logs:
```bash
# All services
docker-compose logs -f

# Specific service
docker-compose logs -f backend
```

### Maintenance
Regular maintenance tasks:
1. Update system packages:
   ```bash
   sudo apt update && sudo apt upgrade -y
   ```

2. Update Docker images:
   ```bash
   docker-compose pull
   docker-compose up -d
   ```

3. Backup database:
   ```bash
   docker-compose exec postgres pg_dump -U aiagent aiagent_db > backup.sql
   ```

### Troubleshooting
Common issues and solutions:

1. If services fail to start:
   ```bash
   docker-compose down
   docker-compose up -d
   ```

2. Check service logs:
   ```bash
   docker-compose logs [service_name]
   ```

3. Reset service:
   ```bash
   docker-compose restart [service_name]
   ```

## Phase 1 Completion Status

### ✅ Completed Tasks
- [x] Base system configuration
- [x] Docker and container orchestration setup
- [x] Nginx reverse proxy configuration
- [x] SSL/TLS certificate setup
- [x] Database configuration
- [x] Redis setup
- [x] Basic monitoring and logging infrastructure

### 🔄 Next Phase
Moving to Phase 2: Core Backend Development
- API development
- Database schema implementation
- Authentication system
- Real-time communication setup

### 📝 Notes
- All infrastructure components are containerized
- Security best practices implemented
- System optimization completed
- Monitoring and logging basics in place

For any issues or questions, please refer to the project documentation or create an issue in the repository.
