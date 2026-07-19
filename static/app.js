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

    // --- ClipCut Frontend Controller ---

    const tabDownloader = document.getElementById('tab-downloader');
    const tabClipcut = document.getElementById('tab-clipcut');
    const downloaderContent = document.getElementById('downloader-content');
    const clipcutContent = document.getElementById('clipcut-content');

    // Tab toggling
    tabDownloader.addEventListener('click', () => {
        tabDownloader.classList.add('active');
        tabClipcut.classList.remove('active');
        downloaderContent.classList.remove('hidden');
        clipcutContent.classList.add('hidden');
    });

    tabClipcut.addEventListener('click', () => {
        tabClipcut.classList.add('active');
        tabDownloader.classList.remove('active');
        clipcutContent.classList.remove('hidden');
        downloaderContent.classList.add('hidden');
    });

    // Elements
    const clipcutUrlForm = document.getElementById('clipcut-url-form');
    const clipcutVideoUrlInput = document.getElementById('clipcut-video-url');
    const confirmRightsCheckbox = document.getElementById('confirm-rights');
    const btnClipcutFetch = document.getElementById('btn-clipcut-fetch');
    const btnClipcutText = btnClipcutFetch.querySelector('.btn-text');
    const btnClipcutIcon = btnClipcutFetch.querySelector('.btn-icon');
    const clipcutSpinner = btnClipcutFetch.querySelector('.spinner');

    const clipcutErrorMessage = document.getElementById('clipcut-error-message');
    const clipcutErrorText = document.getElementById('clipcut-error-text');

    const clipcutConfigPanel = document.getElementById('clipcut-config-panel');
    const clipcutThumbnail = document.getElementById('clipcut-thumbnail');
    const clipcutDurationBadge = document.getElementById('clipcut-duration-badge');
    const clipcutTitle = document.getElementById('clipcut-title');
    const clipcutChannel = document.getElementById('clipcut-channel');
    const clipcutResolution = document.getElementById('clipcut-resolution');
    const clipcutQualityWarning = document.getElementById('clipcut-quality-warning');

    const configClipLength = document.getElementById('config-clip-length');
    const configAspectRatio = document.getElementById('config-aspect-ratio');
    const configSkipStart = document.getElementById('config-skip-start');
    const configSkipEnd = document.getElementById('config-skip-end');

    const summaryClipsCount = document.getElementById('summary-clips-count');
    const summaryEstTime = document.getElementById('summary-est-time');
    const btnGenerateClips = document.getElementById('btn-generate-clips');

    const clipcutProcessPanel = document.getElementById('clipcut-process-panel');
    const processStatusText = document.getElementById('process-status-text');
    const processProgressFill = document.getElementById('process-progress-fill');
    const processTaskLog = document.getElementById('process-task-log');

    const clipcutResultsPanel = document.getElementById('clipcut-results-panel');
    const clipsGrid = document.getElementById('clips-grid');
    const btnDownloadZip = document.getElementById('btn-download-zip');

    let clipcutVideoInfo = null;
    let clipcutJobId = null;
    let clipcutPollInterval = null;

    // Fetch Details for ClipCut
    clipcutUrlForm.addEventListener('submit', async (e) => {
        e.preventDefault();

        const url = clipcutVideoUrlInput.value.trim();
        if (!url) return;

        if (!confirmRightsCheckbox.checked) {
            showClipcutError("Please confirm you have the rights to remix this video.");
            return;
        }

        // Reset
        clipcutErrorMessage.classList.add('hidden');
        clipcutConfigPanel.classList.add('hidden');
        clipcutProcessPanel.classList.add('hidden');
        clipcutResultsPanel.classList.add('hidden');

        btnClipcutFetch.disabled = true;
        btnClipcutText.textContent = 'Analyzing...';
        btnClipcutIcon.classList.add('hidden');
        clipcutSpinner.classList.remove('hidden');

        try {
            const response = await fetch('/api/clipcut/info', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url })
            });

            const data = await response.json();

            if (!response.ok || data.error) {
                throw new Error(data.error || 'Failed to extract video information.');
            }

            clipcutVideoInfo = data;
            clipcutVideoInfo.url = url;

            // Populate preview details
            clipcutThumbnail.src = data.thumbnail || 'https://images.unsplash.com/photo-1611162617213-7d7a39e9b1d7?w=500';
            clipcutDurationBadge.textContent = data.duration_str;
            clipcutTitle.textContent = data.title;
            clipcutChannel.innerHTML = `<i class="fa-solid fa-circle-user icon-channel"></i> ${data.uploader}`;
            clipcutResolution.innerHTML = `<i class="fa-solid fa-expand"></i> Max Resolution: ${data.height}p @ ${data.fps}fps`;

            // Low resolution warning
            if (data.is_low_res) {
                clipcutQualityWarning.classList.remove('hidden');
            } else {
                clipcutQualityWarning.classList.add('hidden');
            }

            // Update configuration panel estimations
            recalculateEstimations();

            clipcutConfigPanel.classList.remove('hidden');
            clipcutConfigPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });

        } catch (error) {
            console.error(error);
            showClipcutError(error.message);
        } finally {
            btnClipcutFetch.disabled = false;
            btnClipcutText.textContent = 'Analyze Video';
            btnClipcutIcon.classList.remove('hidden');
            clipcutSpinner.classList.add('hidden');
        }
    });

    // Recompute segments count and processing duration
    function recalculateEstimations() {
        if (!clipcutVideoInfo) return;

        const duration = clipcutVideoInfo.duration;
        const skipStart = parseInt(configSkipStart.value) || 0;
        const skipEnd = parseInt(configSkipEnd.value) || 0;
        const clipLen = parseInt(configClipLength.value) || 60;
        const aspect = configAspectRatio.value;

        const effectiveDuration = Math.max(0, duration - skipStart - skipEnd);
        const numClips = Math.ceil(effectiveDuration / clipLen);

        summaryClipsCount.textContent = `${numClips} clips`;

        if (aspect === 'crop_9_16') {
            const timeEst = Math.max(15, numClips * 10);
            summaryEstTime.innerHTML = `<span style="color: var(--accent-pink);"><i class="fa-solid fa-bolt"></i> Re-encoding (~${timeEst}s processing time)</span>`;
        } else {
            summaryEstTime.innerHTML = `<span style="color: var(--accent-cyan);"><i class="fa-solid fa-bolt-lightning"></i> Stream-copy (Super Fast, ~5s total)</span>`;
        }
    }

    // Attach recalculation event listeners
    [configClipLength, configAspectRatio, configSkipStart, configSkipEnd].forEach(el => {
        el.addEventListener('change', recalculateEstimations);
        el.addEventListener('input', recalculateEstimations);
    });

    // Show error helper
    function showClipcutError(message) {
        clipcutErrorText.textContent = message;
        clipcutErrorMessage.classList.remove('hidden');
    }

    // Generate Clips submit
    btnGenerateClips.addEventListener('click', async () => {
        if (!clipcutVideoInfo) return;

        const clipLen = parseInt(configClipLength.value) || 60;
        const aspect = configAspectRatio.value;
        const skipStart = parseInt(configSkipStart.value) || 0;
        const skipEnd = parseInt(configSkipEnd.value) || 0;

        // Hide config and show progress views
        clipcutConfigPanel.classList.add('hidden');
        
        processStatusText.textContent = "Connecting to backend and launching segments builder...";
        processProgressFill.style.width = '0%';
        processTaskLog.textContent = "Requesting job creation...";
        clipcutProcessPanel.classList.remove('hidden');
        clipcutProcessPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });

        try {
            const response = await fetch('/api/clipcut/process', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    url: clipcutVideoInfo.url,
                    clip_length: clipLen,
                    crop_9_16: aspect === 'crop_9_16',
                    skip_start: skipStart,
                    skip_end: skipEnd,
                    duration: clipcutVideoInfo.duration
                })
            });

            const data = await response.json();
            if (!response.ok || data.error) {
                throw new Error(data.error || 'Failed to start cutting job.');
            }

            clipcutJobId = data.job_id;
            pollClipcutProgress(clipcutJobId);

        } catch (error) {
            clipcutProcessPanel.classList.add('hidden');
            showClipcutError(error.message);
        }
    });

    // Poller
    function pollClipcutProgress(jobId) {
        if (clipcutPollInterval) clearInterval(clipcutPollInterval);

        clipcutPollInterval = setInterval(async () => {
            try {
                const response = await fetch(`/api/clipcut/status/${jobId}`);
                if (!response.ok) {
                    throw new Error('Lost connection to segments processor.');
                }

                const data = await response.json();

                if (data.status === 'downloading') {
                    processStatusText.textContent = "Fetching high-quality stream from YouTube...";
                    processProgressFill.style.width = `${data.progress}%`;
                    processTaskLog.textContent = data.current_step;
                }
                else if (data.status === 'processing') {
                    processStatusText.textContent = "Applying FFmpeg trims and aspect ratios...";
                    processProgressFill.style.width = `${data.progress}%`;
                    processTaskLog.textContent = data.current_step;
                }
                else if (data.status === 'finished') {
                    clearInterval(clipcutPollInterval);
                    renderClipcutResults(data.clips, jobId);
                }
                else if (data.status === 'error') {
                    clearInterval(clipcutPollInterval);
                    throw new Error(data.error || 'Segments process terminated.');
                }

            } catch (error) {
                clearInterval(clipcutPollInterval);
                clipcutProcessPanel.classList.add('hidden');
                showClipcutError(error.message);
            }
        }, 1000); // Poll every 1s
    }

    // Render results grid
    function renderClipcutResults(clips, jobId) {
        clipcutProcessPanel.classList.add('hidden');
        clipsGrid.innerHTML = '';

        const aspect = configAspectRatio.value;
        const isCropped = aspect === 'crop_9_16';

        clips.forEach(clip => {
            const card = document.createElement('div');
            card.className = 'clip-card';

            const thumbUrl = `/api/clipcut/download/${jobId}/${clip.thumbnail}`;
            const clipUrl = `/api/clipcut/download/${jobId}/${clip.filename}`;

            card.innerHTML = `
                <div class="clip-card-thumbnail-wrapper ${isCropped ? 'crop-9-16' : ''}">
                    <img src="${thumbUrl}" alt="Clip preview">
                    <span class="duration-badge">${clip.duration_str}</span>
                </div>
                <div class="clip-card-body">
                    <div class="clip-card-meta">
                        <span class="clip-card-title">Clip #${clip.clip_index}</span>
                        <span class="clip-card-size">MP4 &bull; ${clip.size_str}</span>
                    </div>
                    <button class="btn-download-clip" data-href="${clipUrl}" data-name="Short_Clip_${clip.clip_index}.mp4">
                        <span>Download</span>
                        <i class="fa-solid fa-download"></i>
                    </button>
                </div>
            `;

            card.querySelector('.btn-download-clip').addEventListener('click', (e) => {
                const button = e.currentTarget;
                const link = document.createElement('a');
                link.href = button.getAttribute('data-href');
                link.download = button.getAttribute('data-name');
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
            });

            clipsGrid.appendChild(card);
        });

        // Set ZIP download action
        btnDownloadZip.onclick = () => {
            const zipUrl = `/api/clipcut/download-zip/${jobId}`;
            const link = document.createElement('a');
            link.href = zipUrl;
            link.download = 'shorts_clips.zip';
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        };

        clipcutResultsPanel.classList.remove('hidden');
        clipcutResultsPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
});
