document.addEventListener('DOMContentLoaded', () => {
    const errorMessage = document.getElementById('error-message');
    const errorText = document.getElementById('error-text');
    const videoUrlInput = document.getElementById('video-url');
    const btnFetch = document.getElementById('btn-fetch');

    async function handleApiResponse(response, defaultErrorMsg) {
        const contentType = response.headers.get("content-type");
        if (contentType && contentType.indexOf("application/json") !== -1) {
            let data;
            try {
                data = await response.json();
                if (!response.ok || data.error) {
                    throw new Error(data.error || defaultErrorMsg);
                }
                return data;
            } catch (e) {
                if (e.message && e.message.indexOf("Server error") === -1 && e.message !== defaultErrorMsg && !data) {
                    throw new Error(defaultErrorMsg);
                }
                throw e;
            }
        } else {
            throw new Error("Server error (Status " + response.status + "). Please check your cookies.txt or server logs.");
        }
    }

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
            
            const data = await handleApiResponse(response, 'Failed to extract video information.');
            
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
            
            const data = await handleApiResponse(response, 'Failed to start download task.');
            
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
                const data = await handleApiResponse(response, 'Lost connection to download state.');
                
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
    const configClipQuality = document.getElementById('config-clip-quality');
    const configSkipStartMin = document.getElementById('config-skip-start-min');
    const configSkipStartSec = document.getElementById('config-skip-start-sec');
    const configSkipEndStartMin = document.getElementById('config-skip-end-start-min');
    const configSkipEndStartSec = document.getElementById('config-skip-end-start-sec');
    const configSkipEndEndMin = document.getElementById('config-skip-end-end-min');
    const configSkipEndEndSec = document.getElementById('config-skip-end-end-sec');
    const configCustomSkipStartMin = document.getElementById('config-custom-skip-start-min');
    const configCustomSkipStartSec = document.getElementById('config-custom-skip-start-sec');
    const configCustomSkipEndMin = document.getElementById('config-custom-skip-end-min');
    const configCustomSkipEndSec = document.getElementById('config-custom-skip-end-sec');

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

    // Video Preview Modal selectors
    const previewModal = document.getElementById('preview-modal');
    const previewModalTitle = document.getElementById('preview-modal-title');
    const previewVideo = document.getElementById('preview-video');
    const btnClosePreview = document.getElementById('btn-close-preview');


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

            const data = await handleApiResponse(response, 'Failed to extract video information.');

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
        const skipStart = (parseInt(configSkipStartMin.value) || 0) * 60 + (parseInt(configSkipStartSec.value) || 0);
        const skipEndStart = (parseInt(configSkipEndStartMin.value) || 0) * 60 + (parseInt(configSkipEndStartSec.value) || 0);
        const skipEndEnd = (parseInt(configSkipEndEndMin.value) || 0) * 60 + (parseInt(configSkipEndEndSec.value) || 0);
        const customSkipStart = (parseInt(configCustomSkipStartMin.value) || 0) * 60 + (parseInt(configCustomSkipStartSec.value) || 0);
        const customSkipEnd = (parseInt(configCustomSkipEndMin.value) || 0) * 60 + (parseInt(configCustomSkipEndSec.value) || 0);
        const clipLen = parseInt(configClipLength.value) || 60;
        const aspect = configAspectRatio.value;

        function subtractInterval(intervals, x, y) {
            let newIntervals = [];
            for (let [start, end] of intervals) {
                if (y <= start || x >= end) {
                    newIntervals.push([start, end]);
                } else {
                    if (x > start) {
                        newIntervals.push([start, x]);
                    }
                    if (y < end) {
                        newIntervals.push([y, end]);
                    }
                }
            }
            return newIntervals;
        }

        // Calculate intervals
        let playableIntervals = [];
        if (duration > skipStart) {
            playableIntervals.push([skipStart, duration]);
        }

        // Subtract Custom Skip
        if (customSkipStart > 0 && customSkipEnd > customSkipStart) {
            playableIntervals = subtractInterval(playableIntervals, customSkipStart, customSkipEnd);
        }

        // Subtract Outro Skip
        if (skipEndStart > 0 && skipEndEnd > skipEndStart) {
            playableIntervals = subtractInterval(playableIntervals, skipEndStart, skipEndEnd);
        }

        let numClips = 0;
        for (let [start, end] of playableIntervals) {
            if (end > start) {
                numClips += Math.ceil((end - start) / clipLen);
            }
        }

        summaryClipsCount.textContent = `${numClips} clips`;

        if (aspect === 'crop_9_16') {
            const timeEst = Math.max(15, numClips * 10);
            summaryEstTime.innerHTML = `<span style="color: var(--accent-pink);"><i class="fa-solid fa-bolt"></i> Re-encoding (~${timeEst}s processing time)</span>`;
        } else {
            summaryEstTime.innerHTML = `<span style="color: var(--accent-cyan);"><i class="fa-solid fa-bolt-lightning"></i> Stream-copy (Super Fast, ~5s total)</span>`;
        }
    }

    // Attach recalculation event listeners
    [configClipLength, configAspectRatio, configClipQuality, 
     configSkipStartMin, configSkipStartSec, 
     configSkipEndStartMin, configSkipEndStartSec, 
     configSkipEndEndMin, configSkipEndEndSec, 
     configCustomSkipStartMin, configCustomSkipStartSec, 
     configCustomSkipEndMin, configCustomSkipEndSec].forEach(el => {
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
        const quality = configClipQuality.value;
        const skipStart = (parseInt(configSkipStartMin.value) || 0) * 60 + (parseInt(configSkipStartSec.value) || 0);
        const skipEndStart = (parseInt(configSkipEndStartMin.value) || 0) * 60 + (parseInt(configSkipEndStartSec.value) || 0);
        const skipEndEnd = (parseInt(configSkipEndEndMin.value) || 0) * 60 + (parseInt(configSkipEndEndSec.value) || 0);
        const customSkipStart = (parseInt(configCustomSkipStartMin.value) || 0) * 60 + (parseInt(configCustomSkipStartSec.value) || 0);
        const customSkipEnd = (parseInt(configCustomSkipEndMin.value) || 0) * 60 + (parseInt(configCustomSkipEndSec.value) || 0);

        // Clear all skip input values for next round
        configSkipStartMin.value = '';
        configSkipStartSec.value = '';
        configSkipEndStartMin.value = '';
        configSkipEndStartSec.value = '';
        configSkipEndEndMin.value = '';
        configSkipEndEndSec.value = '';
        configCustomSkipStartMin.value = '';
        configCustomSkipStartSec.value = '';
        configCustomSkipEndMin.value = '';
        configCustomSkipEndSec.value = '';

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
                    quality: quality,
                    skip_start: skipStart,
                    skip_end_start: skipEndStart,
                    skip_end_end: skipEndEnd,
                    custom_skip_start: customSkipStart,
                    custom_skip_end: customSkipEnd,
                    duration: clipcutVideoInfo.duration
                })
            });

            const data = await handleApiResponse(response, 'Failed to start cutting job.');

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
                const data = await handleApiResponse(response, 'Lost connection to segments processor.');

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
                    <div class="clip-actions-row">
                        <button class="btn-preview-clip" data-href="${clipUrl}" data-title="Clip #${clip.clip_index}">
                            <span>Preview</span>
                            <i class="fa-solid fa-play"></i>
                        </button>
                        <button class="btn-download-clip" data-href="${clipUrl}" data-name="Short_Clip_${clip.clip_index}.mp4">
                            <span>Download</span>
                            <i class="fa-solid fa-download"></i>
                        </button>
                    </div>
                </div>
            `;

            // Download Trigger
            card.querySelector('.btn-download-clip').addEventListener('click', (e) => {
                const button = e.currentTarget;
                const link = document.createElement('a');
                link.href = button.getAttribute('data-href');
                link.download = button.getAttribute('data-name');
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
            });

            // Preview Modal Trigger
            card.querySelector('.btn-preview-clip').addEventListener('click', (e) => {
                const button = e.currentTarget;
                const videoUrl = button.getAttribute('data-href');
                const title = button.getAttribute('data-title');

                previewModalTitle.textContent = `Preview - ${title}`;
                previewVideo.src = videoUrl;
                previewModal.classList.remove('hidden');
                previewVideo.play().catch(err => console.log("Autoplay blocked:", err));
            });

            clipsGrid.appendChild(card);
        });

        // Close Preview Modal event listeners
        btnClosePreview.onclick = () => {
            previewModal.classList.add('hidden');
            previewVideo.pause();
            previewVideo.src = '';
        };

        previewModal.onclick = (e) => {
            if (e.target === previewModal) {
                previewModal.classList.add('hidden');
                previewVideo.pause();
                previewVideo.src = '';
            }
        };

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
