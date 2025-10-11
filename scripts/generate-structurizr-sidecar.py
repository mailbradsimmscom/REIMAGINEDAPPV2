"""
Generate Python Sidecar Architecture Model
Scans python-sidecar/ directory and creates detailed Structurizr model
"""
import os
import json

PYTHON_DIR = "python-sidecar/app"
STRUCTURIZR_DIR = "structurizr"

os.makedirs(STRUCTURIZR_DIR, exist_ok=True)

def scan_python_files(base_dir):
    """Scan Python directory and categorize files"""
    routes = []
    services = []
    processors = []
    utils = []
    
    for root, dirs, files in os.walk(base_dir):
        # Skip __pycache__ and venv
        dirs[:] = [d for d in dirs if d not in ['__pycache__', 'venv', '.venv']]
        
        for file in files:
            if file.endswith('.py') and not file.startswith('__'):
                full_path = os.path.join(root, file)
                rel_path = os.path.relpath(full_path, base_dir)
                component_id = f"python-{rel_path.replace(os.sep, '-').replace('.py', '')}"
                # Use relative path as name to ensure uniqueness
                display_name = rel_path.replace('.py', '').replace(os.sep, '/')
                
                component = {
                    "id": component_id,
                    "name": display_name,
                    "description": rel_path,
                    "technology": "Python",
                    "tags": ""
                }
                
                # Categorize by path/name
                if 'route' in rel_path.lower() or 'api' in rel_path.lower():
                    component['tags'] = 'Route'
                    routes.append(component)
                elif 'service' in rel_path.lower():
                    component['tags'] = 'Service'
                    services.append(component)
                elif 'processor' in rel_path.lower() or 'dip' in rel_path.lower():
                    component['tags'] = 'Processor'
                    processors.append(component)
                else:
                    component['tags'] = 'Utility'
                    utils.append(component)
    
    return {
        'routes': routes,
        'services': services,
        'processors': processors,
        'utils': utils
    }

# Scan the Python codebase
components = scan_python_files(PYTHON_DIR)
all_components = (
    components['routes'] +
    components['services'] +
    components['processors'] +
    components['utils']
)

print(f"📊 Scanned Python sidecar:")
print(f"   - Routes: {len(components['routes'])}")
print(f"   - Services: {len(components['services'])}")
print(f"   - Processors: {len(components['processors'])}")
print(f"   - Utils: {len(components['utils'])}")
print(f"   📦 Total: {len(all_components)} components")

# Create containers for logical grouping
containers = []

if components['routes']:
    containers.append({
        "id": "python-routes",
        "name": "FastAPI Routes",
        "description": "HTTP endpoints for document processing",
        "technology": "FastAPI",
        "tags": "Container,Routes",
        "components": components['routes']
    })

if components['processors']:
    containers.append({
        "id": "python-processors",
        "name": "Document Processors",
        "description": "DIP pipeline and document analysis",
        "technology": "Python",
        "tags": "Container,Processors",
        "components": components['processors']
    })

if components['services']:
    containers.append({
        "id": "python-services",
        "name": "LLM Services",
        "description": "Language model integration and processing",
        "technology": "Python + OpenAI",
        "tags": "Container,Services",
        "components": components['services']
    })

if components['utils']:
    containers.append({
        "id": "python-utils",
        "name": "Utilities",
        "description": "Helper functions and utilities",
        "technology": "Python",
        "tags": "Container,Utils",
        "components": components['utils']
    })

# Build the software system
python_system = {
    "id": "python-sidecar",
    "name": "Python Sidecar Service",
    "description": "FastAPI microservice for document processing and LLM operations",
    "location": "Internal",
    "tags": "SoftwareSystem,Python",
    "containers": containers
}

# Create the workspace fragment
workspace = {
    "workspace": {
        "name": "REIMAGINEDAPPV2 - Python Sidecar",
        "description": "Auto-generated from python-sidecar/ directory",
        "model": {
            "softwareSystems": [python_system]
        }
    }
}

# Write the python.json file
output_path = os.path.join(STRUCTURIZR_DIR, "python.json")
with open(output_path, "w") as f:
    json.dump(workspace, f, indent=2)

print(f"✅ Generated Python model")
print(f"📁 Output: {output_path}")
print(f"📊 {len(containers)} containers with {len(all_components)} components total")
