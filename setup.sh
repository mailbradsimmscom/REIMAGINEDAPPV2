#!/bin/bash

# Reimagined App V2 - Setup Script
# This script automates the setup process for new machines

set -e  # Exit on any error

echo "🚀 Reimagined App V2 - Setup Script"
echo "=================================="

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Function to check if command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Function to check Node.js version
check_node_version() {
    if command_exists node; then
        NODE_VERSION=$(node --version | cut -d'v' -f2 | cut -d'.' -f1)
        if [ "$NODE_VERSION" -ge 20 ]; then
            print_success "Node.js version $(node --version) is compatible"
            return 0
        else
            print_error "Node.js version $(node --version) is too old. Required: 20+"
            return 1
        fi
    else
        print_error "Node.js is not installed"
        return 1
    fi
}

# Function to check Docker
check_docker() {
    if command_exists docker && command_exists docker-compose; then
        print_success "Docker and Docker Compose are installed"
        return 0
    else
        print_error "Docker and/or Docker Compose are not installed"
        return 1
    fi
}

# Function to create .env file
create_env_file() {
    if [ ! -f .env ]; then
        print_status "Creating .env file from template..."
        cat > .env << 'EOF'
# Required: Supabase Configuration
SUPABASE_URL=your_supabase_url
SUPABASE_SERVICE_KEY=your_supabase_service_key

# Required: Pinecone Configuration  
PINECONE_API_KEY=your_pinecone_api_key
PINECONE_INDEX=your_pinecone_index_name
PINECONE_REGION=your_pinecone_region
PINECONE_CLOUD=your_pinecone_cloud
PINECONE_NAMESPACE=REIMAGINEDDOCS

# Required: OpenAI Configuration
OPENAI_API_KEY=your_openai_api_key
OPENAI_MODEL=gpt-4

# Optional: Application Configuration
NODE_ENV=development
PORT=3000
APP_VERSION=1.0.0

# Optional: Search Configuration
SEARCH_RANK_FLOOR=0.5
SEARCH_MAX_ROWS=8
SUMMARY_FREQUENCY=5

# Optional: Python Sidecar Configuration
PYTHON_SIDECAR_URL=http://localhost:8000
SIDECAR_HEALTH_CHECK_INTERVAL=30000
SIDECAR_STARTUP_TIMEOUT=30000
EOF
        print_success ".env file created"
        print_warning "Please edit .env file with your actual credentials"
    else
        print_status ".env file already exists"
    fi
}

# Function to install Node.js dependencies
install_dependencies() {
    print_status "Installing Node.js dependencies..."
    if [ -f package.json ]; then
        npm install
        print_success "Node.js dependencies installed"
    else
        print_error "package.json not found"
        exit 1
    fi
}

# Function to create logs directory
create_logs_directory() {
    print_status "Creating logs directory..."
    mkdir -p logs
    print_success "Logs directory created"
}

# Function to check if services are running
check_services() {
    print_status "Checking if services are running..."
    
    # Check if Docker containers are running
    if docker-compose ps | grep -q "Up"; then
        print_success "Docker services are running"
        
        # Check Node.js server
        if curl -s http://localhost:3000/health > /dev/null; then
            print_success "Node.js server is responding"
        else
            print_warning "Node.js server is not responding"
        fi
        
        # Check Python sidecar
        if curl -s http://localhost:8000/health > /dev/null; then
            print_success "Python sidecar is responding"
        else
            print_warning "Python sidecar is not responding"
        fi
    else
        print_warning "Docker services are not running"
        print_status "Run 'docker-compose up -d' to start services"
    fi
}

# Function to display next steps
show_next_steps() {
    echo ""
    echo "🎉 Setup Complete!"
    echo "=================="
    echo ""
    echo "Next steps:"
    echo "1. Edit .env file with your credentials:"
    echo "   nano .env"
    echo ""
    echo "2. Start the services:"
    echo "   docker-compose up -d"
    echo ""
    echo "3. Verify installation:"
    echo "   curl http://localhost:3000/health"
    echo "   curl http://localhost:8000/health"
    echo ""
    echo "4. Access the application:"
    echo "   Main app: http://localhost:3000"
    echo "   Admin dashboard: http://localhost:3000/admin"
    echo ""
    echo "5. View logs:"
    echo "   docker-compose logs -f"
    echo "   tail -f logs/combined.log"
    echo ""
    echo "For more information, see README.md"
}

# Main setup process
main() {
    print_status "Starting setup process..."
    
    # Check prerequisites
    print_status "Checking prerequisites..."
    
    if ! check_node_version; then
        print_error "Please install Node.js 20+ before continuing"
        print_status "Visit: https://nodejs.org/"
        exit 1
    fi
    
    if ! check_docker; then
        print_error "Please install Docker and Docker Compose before continuing"
        print_status "Visit: https://docs.docker.com/get-docker/"
        exit 1
    fi
    
    # Create necessary directories and files
    create_logs_directory
    create_env_file
    
    # Install dependencies
    install_dependencies
    
    # Check if services are already running
    check_services
    
    # Show next steps
    show_next_steps
}

# Run main function
main "$@"
