const listenersByUser = new Map();

const addListener = (userId, response, { filter } = {}) => {
  const key = String(userId);
  const listeners = listenersByUser.get(key) || new Set();
  const listener = { response, filter };
  listeners.add(listener);
  listenersByUser.set(key, listeners);
  response.on('close', () => {
    listeners.delete(listener);
    if (!listeners.size) listenersByUser.delete(key);
  });
};

const publishNotification = (userId, notification) => {
  const listeners = listenersByUser.get(String(userId));
  if (!listeners) return;
  const event = `event: notification\ndata: ${JSON.stringify(notification)}\n\n`;
  for (const { response, filter } of listeners) {
    if (filter && !filter(notification)) continue;
    if (!response.destroyed) response.write(event);
  }
};

module.exports = { addListener, publishNotification };
