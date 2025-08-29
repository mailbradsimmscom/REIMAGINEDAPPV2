const input = document.getElementById('messageInput');
const send = document.getElementById('sendBtn');
const chat = document.querySelector('.chat');

function addOutboundMessage(text) {
  const wrapper = document.createElement('div');
  wrapper.className = 'message outbound';
  wrapper.innerHTML = `
    <div class="bubble">
      <div class="content"></div>
      <div class="timestamp"></div>
    </div>
  `;
  wrapper.querySelector('.content').textContent = text;
  wrapper.querySelector('.timestamp').textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  chat.appendChild(wrapper);
  chat.scrollTop = chat.scrollHeight;
}

function handleSend() {
  const value = input.value.trim();
  if (!value) return;
  addOutboundMessage(value);
  fetch(`/systems/search?q=${encodeURIComponent(value)}`)
    .then((r) => r.json())
    .then((data) => {
      const wrapper = document.createElement('div');
      wrapper.className = 'message inbound';
      wrapper.innerHTML = `
        <div class="bubble">
          <div class="content"></div>
          <div class="timestamp"></div>
        </div>
      `;
      const payload = data && data.items ? data.items : data;
      wrapper.querySelector('.content').textContent = JSON.stringify(payload);
      wrapper.querySelector('.timestamp').textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      chat.appendChild(wrapper);
      chat.scrollTop = chat.scrollHeight;
    })
    .catch((e) => {
      const wrapper = document.createElement('div');
      wrapper.className = 'message inbound';
      wrapper.textContent = `Error: ${e.message}`;
      chat.appendChild(wrapper);
    })
    .finally(() => {
      input.value = '';
    });
}

send.addEventListener('click', handleSend);
input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') handleSend();
});


