export function healthRoute(req, res) {
  res.statusCode = 200;
  res.setHeader('content-type', 'application/json');
  res.end(
    JSON.stringify({ status: 'ok', uptimeSeconds: Math.floor(process.uptime()) })
  );
}

export default healthRoute;


