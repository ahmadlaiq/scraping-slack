document.addEventListener('DOMContentLoaded', async () => {
  try {
    const response = await fetch('/data');
    if (!response.ok) {
      throw new Error('Gagal memuat data');
    }
    const messages = await response.json();
    const container = document.getElementById('messages-container');
    const threadSidebar = document.getElementById('thread-sidebar');
    const threadContent = document.getElementById('thread-content');
    const closeSidebarBtn = document.getElementById('close-sidebar');

    closeSidebarBtn.addEventListener('click', () => {
      threadSidebar.classList.remove('open');
    });

    function renderImages(images) {
      if (!images || images.length === 0) return null;
      const div = document.createElement('div');
      div.className = 'mt-2 flex flex-wrap gap-2';
      images.forEach(imgName => {
        const img = document.createElement('img');
        img.src = /data/images/${imgName};
        img.alt = 'Image';
        img.className = 'w-32 h-auto rounded border';
        div.appendChild(img);
      });
      return div;
    }

    function renderVideos(videos) {
      if (!videos || videos.length === 0) return null;
      const div = document.createElement('div');
      div.className = 'mt-2 flex flex-wrap gap-2';
      videos.forEach(videoName => {
        const video = document.createElement('video');
        video.src = /data/videos/${videoName};
        video.controls = true;
        video.className = 'w-32 h-auto rounded border';
        div.appendChild(video);
      });
      return div;
    }

    function showThreadSidebar(threads) {
      threadContent.innerHTML = '';
      threads.forEach(tmsg => {
        const msgDiv = document.createElement('div');
        msgDiv.className = 'thread-message';

        const usernameEl = document.createElement('div');
        usernameEl.className = 'font-semibold text-blue-600';
        usernameEl.textContent = tmsg.username || 'Unknown User';
        msgDiv.appendChild(usernameEl);

        const timeEl = document.createElement('div');
        timeEl.className = 'text-sm text-gray-500';
        timeEl.textContent = tmsg.timestamp || 'Unknown Time';
        msgDiv.appendChild(timeEl);

        if (tmsg.regular_message && tmsg.regular_message.trim() !== '') {
          const textEl = document.createElement('div');
          textEl.className = 'mt-1';
          textEl.textContent = tmsg.regular_message;
          msgDiv.appendChild(textEl);
        }

        const imgEl = renderImages(tmsg.images);
        if (imgEl) msgDiv.appendChild(imgEl);

        const vidEl = renderVideos(tmsg.videos);
        if (vidEl) msgDiv.appendChild(vidEl);

        if (tmsg.emotes && tmsg.emotes.length > 0) {
          const emoteEl = document.createElement('div');
          emoteEl.className = 'mt-1 text-sm text-gray-700';
          emoteEl.textContent = Emotes: ${tmsg.emotes.join(', ')};
          msgDiv.appendChild(emoteEl);
        }

        threadContent.appendChild(msgDiv);
      });

      threadSidebar.classList.add('open');
    }

    function createMessageCard(message) {
      const card = document.createElement('div');
      // Card styling
      card.className = 'bg-white shadow-md rounded-lg p-4 hover:shadow-lg transition-shadow mb-4';

      const contentWrapper = document.createElement('div');
      contentWrapper.className = 'flex-1';

      // Header: Username dan timestamp
      const header = document.createElement('div');
      header.className = 'flex items-center justify-between';

      const usernameEl = document.createElement('h3');
      usernameEl.className = 'font-semibold text-gray-800';
      usernameEl.textContent = message.username || 'Unknown User';
      header.appendChild(usernameEl);

      const timeEl = document.createElement('span');
      timeEl.className = 'text-xs text-gray-500';
      timeEl.textContent = message.timestamp || 'Unknown Time';
      header.appendChild(timeEl);

      contentWrapper.appendChild(header);

      // Isi pesan
      if (message.regular_message && message.regular_message.trim() !== '') {
        const textEl = document.createElement('p');
        textEl.className = 'text-gray-700 mt-1';
        textEl.textContent = message.regular_message;
        contentWrapper.appendChild(textEl);
      }

      // Gambar
      const imgEl = renderImages(message.images);
      if (imgEl) contentWrapper.appendChild(imgEl);

      // Video
      const vidEl = renderVideos(message.videos);
      if (vidEl) contentWrapper.appendChild(vidEl);

      // Emotes
      if (message.emotes && message.emotes.length > 0) {
        const emoteEl = document.createElement('div');
        emoteEl.className = 'mt-2 text-sm text-gray-700';
        emoteEl.textContent = Emotes: ${message.emotes.join(', ')};
        contentWrapper.appendChild(emoteEl);
      }

      // Thread
      if (message.threads && message.threads.length > 0) {
        const threadBtn = document.createElement('button');
        threadBtn.textContent = View thread (${message.threads.length} replies);
        threadBtn.className = 'mt-2 text-blue-500 underline text-sm';
        threadBtn.addEventListener('click', () => {
          showThreadSidebar(message.threads);
        });
        contentWrapper.appendChild(threadBtn);
      }

      // Masukkan contentWrapper ke card
      card.appendChild(contentWrapper);

      return card;
    }

    messages.forEach(message => {
      const card = createMessageCard(message);
      container.appendChild(card);
    });
  } catch (err) {
    console.error('Error:', err.message);
    const container = document.getElementById('messages-container');
    container.textContent = 'Gagal memuat pesan.';
  }
});
