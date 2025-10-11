/**
 * Combine Node.js and Python models into unified Structurizr workspace
 * Creates compatible views that work reliably in Structurizr Cloud
 */
import fs from "fs";

const STRUCTURIZR_DIR = "structurizr";

// Read partial models
const node = JSON.parse(fs.readFileSync(`${STRUCTURIZR_DIR}/node.json`, "utf-8"));
const py = JSON.parse(fs.readFileSync(`${STRUCTURIZR_DIR}/python.json`, "utf-8"));

// Helper to assign IDs to any elements missing them
let nextId = 1;
function assignIds(element) {
  if (Array.isArray(element)) {
    element.forEach(assignIds);
  } else if (element && typeof element === "object") {
    if (!element.id) element.id = `e${nextId++}`;
    for (const key of Object.keys(element)) {
      assignIds(element[key]);
    }
  }
}

// Assign IDs inside each partial workspace
assignIds(node.workspace.model);
assignIds(py.workspace.model);

// Extract the top-level systems with all their containers and components
const nodeSystem = node.workspace.model.softwareSystems[0];
const pySystem = py.workspace.model.softwareSystems[0];

// Add people
const user = {
  id: `e${nextId++}`,
  name: "End User / Admin",
  description: "Users and administrators of the REIMAGINEDAPPV2 application",
  tags: "Person"
};

// Add external systems
const supabase = {
  id: `e${nextId++}`,
  name: "Supabase",
  description: "PostgreSQL database with real-time features and storage",
  location: "External",
  tags: "SoftwareSystem,External,Database"
};

const pinecone = {
  id: `e${nextId++}`,
  name: "Pinecone Vector DB",
  description: "Vector database for semantic search and embeddings",
  location: "External",
  tags: "SoftwareSystem,External,Vector"
};

const openai = {
  id: `e${nextId++}`,
  name: "OpenAI API",
  description: "GPT models and embeddings API",
  location: "External",
  tags: "SoftwareSystem,External,LLM"
};

// --- SYSTEM-LEVEL RELATIONSHIPS ---
const relationships = [
  {
    id: `r${nextId++}`,
    sourceId: user.id,
    destinationId: nodeSystem.id,
    description: "Uses web application and dashboard"
  },
  {
    id: `r${nextId++}`,
    sourceId: nodeSystem.id,
    destinationId: pySystem.id,
    description: "Sends DIP jobs and document processing requests"
  },
  {
    id: `r${nextId++}`,
    sourceId: nodeSystem.id,
    destinationId: supabase.id,
    description: "Reads/writes structured data and files"
  },
  {
    id: `r${nextId++}`,
    sourceId: nodeSystem.id,
    destinationId: pinecone.id,
    description: "Stores and retrieves vector embeddings"
  },
  {
    id: `r${nextId++}`,
    sourceId: nodeSystem.id,
    destinationId: openai.id,
    description: "LLM completions and chat"
  },
  {
    id: `r${nextId++}`,
    sourceId: pySystem.id,
    destinationId: openai.id,
    description: "Advanced LLM processing for DIP extraction"
  },
  {
    id: `r${nextId++}`,
    sourceId: pySystem.id,
    destinationId: supabase.id,
    description: "Stores generated DIP results and metadata"
  }
];

// --- FINAL WORKSPACE ---
const workspace = {
  id: 107225,
  name: "REIMAGINEDAPPV2",
  description: "Full system architecture with Node.js backend, Python sidecar, and external integrations",
  model: {
    people: [user],
    softwareSystems: [nodeSystem, pySystem, supabase, pinecone, openai],
    relationships
  },
  views: {
    // === A. System Landscape ===
    systemLandscape: {
      key: "SystemLandscape",
      title: "System Landscape - Complete Ecosystem",
      description: "Overall ecosystem of REIMAGINEDAPPV2 and connected systems",
      automaticLayout: { 
        rankDirection: "LeftRight",
        rankSeparation: 300,
        nodeSeparation: 200
      }
    },

    // === B. System Context ===
    systemContext: {
      key: "SystemContext",
      title: "System Context - REIMAGINEDAPPV2",
      description: "How REIMAGINEDAPPV2 relates to users and external systems",
      softwareSystemId: nodeSystem.id,
      automaticLayout: { 
        rankDirection: "TopBottom",
        rankSeparation: 250,
        nodeSeparation: 150
      }
    },

    // === C. Container Views ===
    container: [
      {
        key: "NodeContainers",
        title: "Node.js Backend - Internal Architecture",
        description: "Routes → Services → Repositories pattern with middleware",
        softwareSystemId: nodeSystem.id,
        automaticLayout: {
          rankDirection: "TopBottom",
          rankSeparation: 150,
          nodeSeparation: 100
        }
      },
      {
        key: "PythonContainers",
        title: "Python Sidecar - Internal Architecture", 
        description: "Document processors, LLM services, and utilities",
        softwareSystemId: pySystem.id,
        automaticLayout: {
          rankDirection: "TopBottom",
          rankSeparation: 150,
          nodeSeparation: 100
        }
      }
    ],

    // === D. Component Views ===
    component: [
      {
        key: "NodeComponents",
        title: "Node.js Components - Detailed View",
        description: "Individual routes, services, repositories, middleware, and utilities",
        softwareSystemId: nodeSystem.id,
        containerId: "webapp-routes",
        automaticLayout: {
          rankDirection: "TopBottom",
          rankSeparation: 100,
          nodeSeparation: 50
        }
      }
    ],

    // === E. Styling ===
    styles: {
      elements: [
        {
          tag: "Person",
          background: "#08427b",
          color: "#ffffff",
          shape: "Person",
          fontSize: 32
        },
        {
          tag: "SoftwareSystem",
          background: "#1168bd",
          color: "#ffffff",
          fontSize: 28,
          shape: "Box"
        },
        {
          tag: "Container",
          background: "#438dd5",
          color: "#ffffff",
          fontSize: 24
        },
        {
          tag: "Component",
          background: "#85bbf0",
          color: "#000000",
          fontSize: 18
        },
        {
          tag: "External",
          background: "#999999",
          color: "#ffffff",
          fontSize: 24
        },
        {
          tag: "Database",
          background: "#FF9800",
          color: "#ffffff",
          shape: "Cylinder",
          fontSize: 24
        },
        {
          tag: "Vector",
          background: "#E91E63",
          color: "#ffffff",
          shape: "Cylinder",
          fontSize: 24
        },
        {
          tag: "LLM",
          background: "#9C27B0",
          color: "#ffffff",
          fontSize: 24
        },
        {
          tag: "Python",
          background: "#4CAF50",
          color: "#ffffff",
          fontSize: 24
        },
        {
          tag: "Backend",
          background: "#1168bd",
          color: "#ffffff",
          fontSize: 24
        },
        {
          tag: "Route",
          background: "#5c9bd5",
          color: "#ffffff",
          fontSize: 18
        },
        {
          tag: "Service",
          background: "#7cb5ec",
          color: "#000000",
          fontSize: 18
        },
        {
          tag: "Repository",
          background: "#9cc3f0",
          color: "#000000",
          fontSize: 18
        },
        {
          tag: "Middleware",
          background: "#bcd6f4",
          color: "#000000",
          fontSize: 18
        },
        {
          tag: "Model",
          background: "#d6e8f8",
          color: "#000000",
          fontSize: 18
        },
        {
          tag: "Processor",
          background: "#66BB6A",
          color: "#ffffff",
          fontSize: 18
        },
        {
          tag: "Utility",
          background: "#C8E6C9",
          color: "#000000",
          fontSize: 16
        }
      ],
      relationships: [
        {
          tag: "Relationship",
          thickness: 2,
          fontSize: 18,
          routing: "Direct",
          color: "#707070"
        }
      ]
    }
  }
};

// Write the final combined workspace
const outputPath = `${STRUCTURIZR_DIR}/workspace.json`;
fs.writeFileSync(outputPath, JSON.stringify(workspace, null, 2));

console.log(`✅ Unified workspace created successfully`);
console.log(`📊 Architecture summary:`);
console.log(`   - People: ${workspace.model.people.length}`);
console.log(`   - Software Systems: ${workspace.model.softwareSystems.length}`);
console.log(`   - System Relationships: ${workspace.model.relationships.length}`);

// Count containers and components
let totalContainers = 0;
let totalComponents = 0;
workspace.model.softwareSystems.forEach(sys => {
  if (sys.containers) {
    totalContainers += sys.containers.length;
    sys.containers.forEach(container => {
      if (container.components) {
        totalComponents += container.components.length;
      }
    });
  }
});

console.log(`   - Containers: ${totalContainers}`);
console.log(`   - Components: ${totalComponents}`);
console.log(``);
console.log(`📋 Views created:`);
console.log(`   1. System Landscape - All systems overview`);
console.log(`   2. System Context - REIMAGINEDAPPV2 context`);
console.log(`   3. Node.js Containers - Backend internal structure (${totalComponents > 100 ? '100+' : totalComponents} components)`);
console.log(`   4. Python Containers - Sidecar internal structure`);
console.log(`   5. Node.js Components - Detailed component view`);
console.log(``);
console.log(`📁 Final output: ${outputPath}`);
console.log(``);
console.log(`🚀 Ready to push to Structurizr Cloud!`);
console.log(`   Run: npm run structurizr:push`);