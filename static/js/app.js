document.addEventListener('DOMContentLoaded', () => {
    const app = document.getElementById('app');
    
    fetch('/health')
        .then(response => response.json())
        .then(data => {
            const statusDiv = document.createElement('div');
            statusDiv.innerHTML = `<p>API Status: ${data.status}</p>`;
            app.appendChild(statusDiv);
        })
        .catch(error => {
            console.error('Error:', error);
        });
});

