document.addEventListener('DOMContentLoaded', () => {
    const errorMessage = document.getElementById('error-message');
    const errorText = document.getElementById('error-text');
    const videoUrlInput = document.getElementById('video-url');
    const btnFetch = document.getElementById('btn-fetch');

    // Check if opened via file:// protocol
    if (window.location.protocol === 'file:') {
        errorText.innerHTML = '<strong>Warning:</strong> You opened this file directly from the Finder (using the <code>file://</code> protocol). You must open <strong><a href="http://127.0.0.1:5000" target="_blank" style="color: #fca5a5; text-decoration: underline;">http://127.0.0.1:5000</a></strong> in your browser to run the downloader.';
        errorMessage.classList.remove('hidden');
        if (videoUrlInput) videoUrlInput.disabled = true;
        if (btnFetch) btnFetch.disabled = true;
        return;
    }

    const urlForm = document.getElementById('url-form');
    const btnText = btnFetch.querySelector('.btn-text');
    const btnIcon = btnFetch.querySelector('.btn-icon');
    const spinner = btnFetch.querySelector('.spinner');
    
    const resultPanel = document.getElementById('result-panel');
    const videoThumbnail = document.getElementById('video-thumbnail');
    const videoDuration = document.getElementById('video-duration');
    const videoTitle = document.getElementById('video-title');
    const videoChannel = document.getElementById('video-channel');
    const qualityGrid = document.getElementById('quality-grid');
    
    // Modal elements
    const progressModal = document.getElementById('progress-modal');
    const modalStatusTitle = document.getElementById('modal-status-title');
    const modalStatusText = document.getElementById('modal-status-text');
    const progressFill = document.getElementById('progress-fill');
    
    const statPercent = document.getElementById('stat-percent');
    const statSpeed = document.getElementById('stat-speed');
    const statEta = document.getElementById('stat-eta');
    
    const modalSuccess = document.getElementById('modal-success');
    const modalError = document.getElementById('modal-error');
    const modalErrorDesc = document.getElementById('modal-error-desc');
    const progressStatsContainer = document.querySelector('.progress-stats');
    const progressBarContainer = document.querySelector('.progress-bar-container');
    const progressSpinnerIcon = document.querySelector('.progress-spinner');
    
    const btnCloseModal = document.getElementById('btn-close-modal');
    const btnCloseErrorModal = document.getElementById('btn-close-error-modal');
    
    let currentVideoUrl = '';
    let pollInterval = null;
    
    // Fetch Video Details
    urlForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const url = videoUrlInput.value.trim();
        if (!url) return;
        
        // Reset states
        errorMessage.classList.add('hidden');
        resultPanel.classList.add('hidden');
        
        // Show loading state
        btnFetch.disabled = true;
        btnText.textContent = 'Analyzing...';
        btnIcon.classList.add('hidden');
        spinner.classList.remove('hidden');
        
        try {
            const response = await fetch('/api/info', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url })
            });
            
            const data = await response.json();
            
            if (!response.ok || data.error) {
                throw new Error(data.error || 'Failed to extract video information.');
            }
            
            currentVideoUrl = url;
            
            // Populate video preview card
            videoThumbnail.src = data.thumbnail || 'https://images.unsplash.com/photo-1611162617213-7d7a39e9b1d7?w=500';
            videoDuration.textContent = data.duration;
            videoTitle.textContent = data.title;
            videoChannel.innerHTML = `<i class="fa-solid fa-circle-user icon-channel"></i> ${data.uploader}`;
            
            // Render quality grid
            qualityGrid.innerHTML = '';
            
            if (!data.qualities || data.qualities.length === 0) {
                qualityGrid.innerHTML = `
                    <div style="grid-column: 1/-1; text-align: center; color: var(--text-secondary); padding: 20px;">
                        No download formats available for this video.
                    </div>
                `;
            } else {
                data.qualities.forEach(q => {
                    const qualityItem = document.createElement('div');
                    qualityItem.className = 'quality-item';
                    qualityItem.setAttribute('data-height', q.height);
                    
                    qualityItem.innerHTML = `
                        <span class="quality-badge">${getShortLabel(q.height)}</span>
                        <div class="quality-details">
                            <span class="quality-res">${q.label}</span>
                            <span class="quality-size-ext">${q.ext.toUpperCase()} &bull; ${q.size_str}</span>
                        </div>
                        <button class="btn-download-item" data-height="${q.height}">
                            <span>Download</span>
                            <i class="fa-solid fa-download"></i>
                        </button>
                    `;
                    
                    // Click handler for quality download button
                    qualityItem.querySelector('.btn-download-item').addEventListener('click', () => {
                        triggerDownload(q.height);
                    });
                    
                    qualityGrid.appendChild(qualityItem);
                });
            }
            
            // Show result
            resultPanel.classList.remove('hidden');
            resultPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
            
        } catch (error) {
            console.error(error);
            errorText.textContent = error.message;
            errorMessage.classList.remove('hidden');
        } finally {
            // Restore button state
            btnFetch.disabled = false;
            btnText.textContent = 'Analyze Video';
            btnIcon.classList.remove('hidden');
            spinner.classList.add('hidden');
        }
    });
    
    // Short Quality Badge parser
    function getShortLabel(height) {
        if (height >= 2160) return '4K';
        if (height >= 1440) return '2K';
        if (height >= 1080) return '1080p';
        if (height >= 720) return '720p';
        return `${height}p`;
    }
    
    // Trigger download flow
    async function triggerDownload(height) {
        // Reset modal layout
        progressSpinnerIcon.className = "fa-solid fa-circle-notch fa-spin progress-spinner";
        modalStatusTitle.textContent = "Requesting Download";
        modalStatusText.textContent = "Initializing connection with server...";
        progressFill.style.width = '0%';
        statPercent.textContent = '0%';
        statSpeed.textContent = 'N/A';
        statEta.textContent = 'N/A';
        
        progressStatsContainer.classList.remove('hidden');
        progressBarContainer.classList.remove('hidden');
        modalSuccess.classList.add('hidden');
        modalError.classList.add('hidden');
        
        // Show modal
        progressModal.classList.remove('hidden');
        
        try {
            const response = await fetch('/api/download', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    url: currentVideoUrl,
                    height: height
                })
            });
            
            const data = await response.json();
            
            if (!response.ok || data.error) {
                throw new Error(data.error || 'Failed to start download task.');
            }
            
            // Start polling
            const downloadId = data.download_id;
            pollDownloadProgress(downloadId);
            
        } catch (error) {
            showModalError(error.message);
        }
    }
    
    // Polling function for download progress
    function pollDownloadProgress(downloadId) {
        if (pollInterval) clearInterval(pollInterval);
        
        pollInterval = setInterval(async () => {
            try {
                const response = await fetch(`/api/progress/${downloadId}`);
                if (!response.ok) {
                    throw new Error('Lost connection to download state.');
                }
                
                const data = await response.json();
                
                if (data.status === 'downloading') {
                    modalStatusTitle.textContent = "Downloading Video";
                    modalStatusText.textContent = "Fetching high-quality video and audio streams from YouTube...";
                    progressFill.style.width = `${data.progress}%`;
                    statPercent.textContent = `${data.progress}%`;
                    statSpeed.textContent = data.speed;
                    statEta.textContent = data.eta;
                } 
                else if (data.status === 'merging') {
                    modalStatusTitle.textContent = "Processing Streams";
                    modalStatusText.textContent = "Merging video & audio streams using FFmpeg... (This might take a moment for large files)";
                    progressFill.style.width = '100%';
                    statPercent.textContent = 'Merging...';
                    statSpeed.textContent = 'Processing';
                    statEta.textContent = 'A few seconds';
                } 
                else if (data.status === 'finished') {
                    clearInterval(pollInterval);
                    showModalSuccess(data.filename, data.display_name);
                } 
                else if (data.status === 'error') {
                    clearInterval(pollInterval);
                    showModalError(data.error || 'Unknown server error during download.');
                }
                
            } catch (error) {
                clearInterval(pollInterval);
                showModalError(error.message);
            }
        }, 800); // Poll every 800ms
    }
    
    // Success State Modal
    function showModalSuccess(filename, displayName) {
        progressSpinnerIcon.className = "fa-solid fa-circle-check progress-spinner";
        progressSpinnerIcon.style.color = "var(--success-green)";
        modalStatusTitle.textContent = "Process Complete";
        modalStatusText.textContent = "File fully prepared and ready.";
        
        progressStatsContainer.classList.add('hidden');
        progressBarContainer.classList.add('hidden');
        modalSuccess.classList.remove('hidden');
        
        // Trigger browser file download to local device storage
        const downloadUrl = `/api/files/${filename}?name=${encodeURIComponent(displayName)}`;
        const link = document.createElement('a');
        link.href = downloadUrl;
        link.download = displayName;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }
    
    // Error State Modal
    function showModalError(message) {
        progressSpinnerIcon.className = "fa-solid fa-circle-xmark progress-spinner";
        progressSpinnerIcon.style.color = "var(--error-red)";
        modalStatusTitle.textContent = "Error Occurred";
        modalStatusText.textContent = "The download could not be completed.";
        
        progressStatsContainer.classList.add('hidden');
        progressBarContainer.classList.add('hidden');
        
        modalErrorDesc.textContent = message;
        modalError.classList.remove('hidden');
    }
    
    // Close Modal Button Handlers
    btnCloseModal.addEventListener('click', () => {
        progressModal.classList.add('hidden');
        progressSpinnerIcon.style.color = ""; // reset color
    });
    
    btnCloseErrorModal.addEventListener('click', () => {
        progressModal.classList.add('hidden');
        progressSpinnerIcon.style.color = ""; // reset color
    });
});
