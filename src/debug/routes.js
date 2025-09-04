export function mountRouteMap(app) {
  if (process.env.NODE_ENV === 'production') return;
  
  app.get('/__routes', (req, res) => {
    // Manual route map based on our router configuration
    const expectedRoutes = [
      { path: '/health', methods: ['GET'], middleware: 1 },
      { path: '/systems', methods: ['GET'], middleware: 1 },
      { path: '/chat/enhanced', methods: ['GET', 'POST'], middleware: 1 },
      { path: '/chat', methods: ['GET', 'POST'], middleware: 1 },
      { path: '/admin/docs', methods: ['GET', 'POST'], middleware: 1 },
      { path: '/document', methods: ['GET', 'POST'], middleware: 1 },
      { path: '/pinecone/search', methods: ['POST'], middleware: 1 },
      { path: '/pinecone/stats', methods: ['GET'], middleware: 1 },
      { path: '/pinecone/documents/:docId/chunks', methods: ['GET'], middleware: 1 },
      { path: '/pinecone/query', methods: ['POST'], middleware: 1 },
      { path: '/admin/dashboard', methods: ['GET'], middleware: 1 },
      { path: '/admin/health', methods: ['GET'], middleware: 1 },
      { path: '/admin/logs', methods: ['GET'], middleware: 1 },
      { path: '/admin/manufacturers', methods: ['GET'], middleware: 1 },
      { path: '/admin/models', methods: ['GET'], middleware: 1 },
      { path: '/admin/pinecone', methods: ['GET'], middleware: 1 },
      { path: '/admin/systems', methods: ['GET'], middleware: 1 },
      { path: '/__routes', methods: ['GET'], middleware: 0 }
    ];
    
    res.json({
      success: true,
      data: {
        routes: expectedRoutes,
        note: 'Route map shows expected routes based on router configuration'
      }
    });
  });
}
