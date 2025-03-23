document.addEventListener('DOMContentLoaded', () => {
  const shortenBtn = document.getElementById('shortenBtn');
  const urlInput = document.getElementById('urlInput');
  const expirationSelect = document.getElementById('expirationSelect');
  const resultSection = document.getElementById('resultSection');

  shortenBtn.addEventListener('click', async () => {
    const longURL = urlInput.value.trim();
    const expirationMs = expirationSelect.value.trim();

    if (!longURL) {
      alert('Please enter a valid URL.');
      return;
    }

    try {
      const response = await fetch('/shorten', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: longURL, expirationMs })
      });
      const data = await response.json();
      if (data.error) {
        alert(`Error: ${data.error}`);
      } else {
        const shortUrl = `${window.location.origin}/${data.shortCode}`;
        resultSection.innerHTML = `
          <p>Shortened URL:</p>
          <a href="${shortUrl}" target="_blank">${shortUrl}</a>
        `;
      }
    } catch (error) {
      console.error('Error creating short URL:', error);
      alert('There was a problem creating the short URL.');
    }
  });
});
