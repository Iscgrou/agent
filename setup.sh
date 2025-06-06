#!/bin/bash

# Make script executable
chmod +x setup.sh

# Function to print colored output
print_status() {
    echo -e "\033[1;34m>>> $1\033[0m"
}

print_error() {
    echo -e "\033[1;31m>>> Error: $1\033[0m"
}

print_success() {
    echo -e "\033[1;32m>>> Success: $1\033[0m"
}

# Check if Docker is installed
if ! command -v docker &> /dev/null; then
    print_error "Docker is not installed. Please install Docker first."
    exit 1
fi

# Check if Docker Compose is installed
if ! command -v docker-compose &> /dev/null; then
    print_error "Docker Compose is not installed. Please install Docker Compose first."
    exit 1
fi

# Create necessary directories
print_status "Creating necessary directories..."
mkdir -p deployment/nginx/ssl
mkdir -p deployment/nginx/www

# Create environment files if they don't exist
print_status "Setting up environment files..."

# Backend .env
if [ ! -f backend/.env ]; then
    cat > backend/.env << EOL
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
EOL
    print_success "Created backend/.env"
fi

# Frontend .env
if [ ! -f frontend/.env ]; then
    cat > frontend/.env << EOL
VUE_APP_API_URL=http://localhost:3000
VUE_APP_WS_URL=ws://localhost:3000
EOL
    print_success "Created frontend/.env"
fi

# Build and start containers
print_status "Building and starting Docker containers..."
docker-compose build
docker-compose up -d

# Wait for services to be ready
print_status "Waiting for services to be ready..."
sleep 10

# Run database migrations
print_status "Running database migrations..."
docker-compose exec backend npm run migrate up

print_success "Setup completed successfully!"
print_status "You can now access:"
echo "- Frontend: http://localhost:80"
echo "- Backend API: http://localhost:3000"
echo "- API Documentation: http://localhost:3000/api-docs"

print_status "To stop the services, run: docker-compose down"
