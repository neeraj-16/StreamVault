import os
import time
import uuid
import threading
import subprocess
import json
import re
import traceback
from flask import Flask, request, jsonify, send_from_directory
import imageio_ffmpeg

app = Flask(__name__)

# Directories
DOWNLOAD_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'downloads')
CLIPCUT_DIR = os.path.join(DOWNLOAD_DIR, 'clipcut')
os.makedirs(DOWNLOAD_DIR, exist_ok=True)
os.makedirs(CLIPCUT_DIR, exist_ok=True)

BIN_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'bin')
import shutil
import sys

if sys.platform == 'darwin' and os.path.exists(os.path.join(BIN_DIR, 'yt-dlp')):
    YT_DLP_BIN = os.path.join(BIN_DIR, 'yt-dlp')
else:
    YT_DLP_BIN = shutil.which('yt-dlp') or 'yt-dlp'

FFMPEG_EXE = imageio_ffmpeg.get_ffmpeg_exe()

# Global status dictionary
download_status = {}
clipcut_jobs = {}

# Regex for parsing yt-dlp progress
progress_regex = re.compile(
    r'\[download\]\s+(\d+\.\d+)%\s+of\s+.*?\s+at\s+(.*?)\s+ETA\s+(.*)'
)

def format_time(seconds):
    if seconds is None:
        return "N/A"
    mins, secs = divmod(int(seconds), 60)
    hours, mins = divmod(mins, 60)
    if hours > 0:
        return f"{hours:02d}:{mins:02d}:{secs:02d}"
    return f"{mins:02d}:{secs:02d}"

def format_size(size_bytes):
    if not size_bytes:
        return "Unknown size"
    if size_bytes < 1024 * 1024:
        return f"{size_bytes / 1024:.1f} KB"
    elif size_bytes < 1024 * 1024 * 1024:
        return f"{size_bytes / (1024 * 1024):.1f} MB"
    else:
        return f"{size_bytes / (1024 * 1024 * 1024):.1f} GB"

def get_quality_label(height):
    if height >= 2160:
        return f"4K Ultra HD ({height}p)"
    elif height >= 1440:
        return f"2K Quad HD ({height}p)"
    elif height >= 1080:
        return f"Full HD ({height}p)"
    elif height >= 720:
        return f"HD ({height}p)"
    elif height >= 480:
        return f"SD ({height}p)"
    elif height >= 360:
        return f"Medium ({height}p)"
    elif height >= 240:
        return f"Low ({height}p)"
    else:
        return f"Very Low ({height}p)"

def cleanup_old_files():
    """Prunes downloaded cache older than 15 minutes and clipcut jobs older than 1 hour."""
    while True:
        try:
            now = time.time()
            
            # 1. Clean regular downloads
            if os.path.exists(DOWNLOAD_DIR):
                for f in os.listdir(DOWNLOAD_DIR):
                    if f == 'clipcut':
                        continue
                    file_path = os.path.join(DOWNLOAD_DIR, f)
                    if os.path.isfile(file_path):
                        if now - os.path.getmtime(file_path) > 900:
                            try:
                                os.remove(file_path)
                            except Exception:
                                pass
                            keys_to_delete = [k for k, v in download_status.items() if v.get('filename') == f]
                            for k in keys_to_delete:
                                download_status.pop(k, None)
                                
            # 2. Clean clipcut folders (1 hour = 3600 seconds)
            if os.path.exists(CLIPCUT_DIR):
                for d in os.listdir(CLIPCUT_DIR):
                    dir_path = os.path.join(CLIPCUT_DIR, d)
                    if os.path.isdir(dir_path):
                        if now - os.path.getmtime(dir_path) > 3600:
                            try:
                                shutil.rmtree(dir_path)
                            except Exception:
                                pass
                            clipcut_jobs.pop(d, None)
        except Exception as e:
            print(f"Error in cleanup thread: {e}")
        time.sleep(60)

# Start cleanup thread
cleanup_thread = threading.Thread(target=cleanup_old_files, daemon=True)
cleanup_thread.start()

def fix_cookies_format(path):
    """Helper to convert space-separated Netscape cookie files to tab-separated format.
    Copy-pasting cookies into text fields often converts tabs to spaces, which breaks yt-dlp.
    """
    try:
        if not os.path.exists(path):
            return
        
        size = os.path.getsize(path)
        with open(path, 'r', encoding='utf-8') as f:
            lines = f.readlines()
            
        print(f"DEBUG: cookies.txt size is {size} bytes, lines: {len(lines)}", flush=True)
        
        fixed_lines = []
        modified = False
        cookie_count = 0
        
        for line in lines:
            if line.startswith('#') or not line.strip():
                fixed_lines.append(line)
                continue
            
            # Split by whitespace
            parts = line.strip().split()
            if len(parts) >= 7:
                cookie_count += 1
                # Reconstruct with tab separation
                new_line = '\t'.join(parts[:6] + [' '.join(parts[6:])]) + '\n'
                fixed_lines.append(new_line)
                if new_line != line:
                    modified = True
            else:
                fixed_lines.append(line)
                
        print(f"DEBUG: cookies.txt has {cookie_count} parsed cookie entries", flush=True)
        
        if modified:
            print(f"DEBUG: Auto-formatting cookies file at {path} (converting spaces to tabs)", flush=True)
            with open(path, 'w', encoding='utf-8') as f:
                f.writelines(fixed_lines)
    except Exception as e:
        print(f"DEBUG: Error fixing cookies format: {e}", flush=True)

def run_yt_dlp_json(url):
    """Runs standalone yt-dlp in a subprocess to extract metadata as JSON."""
    cmd = [
        YT_DLP_BIN,
        '--js-runtimes', 'node',
        '--ffmpeg-location', FFMPEG_EXE,
        '-J',
        url
    ]
    
    cookies_paths = [
        os.path.join(os.path.dirname(os.path.abspath(__file__)), 'cookies.txt'),
        '/etc/secrets/cookies.txt'
    ]
    cookies_found = False
    for path in cookies_paths:
        if os.path.exists(path):
            fix_cookies_format(path)
            print(f"DEBUG: Found cookies at {path}", flush=True)
            cmd.extend(['--cookies', path])
            cookies_found = True
            break
    if not cookies_found:
        print("DEBUG: No cookies.txt found in any expected paths", flush=True)
    
    # Run process
    result = subprocess.run(cmd, capture_output=True, text=True, encoding='utf-8')
    if result.returncode != 0:
        # Extract the last line of stderr as it usually contains the actual error description
        stderr_lines = result.stderr.strip().split('\n')
        error_msg = stderr_lines[-1] if stderr_lines else "Extraction failed"
        raise Exception(error_msg)
        
    return json.loads(result.stdout)

def download_video_task(url, height, download_id):
    """Subprocess executor that reads stdout in real-time to update progress."""
    download_status[download_id] = {
        'status': 'downloading',
        'progress': 0,
        'speed': '0 KB/s',
        'eta': 'Unknown',
        'filename': '',
        'display_name': '',
        'error': None
    }
    
    # We first extract info to get the original title
    try:
        info = run_yt_dlp_json(url)
        title = info.get('title', 'video')
        # Clean title for standard safe filename
        safe_title = "".join(c for c in title if c.isalnum() or c in (' ', '.', '_', '-')).strip()
        if not safe_title:
            safe_title = 'video'
    except Exception as e:
        download_status[download_id].update({
            'status': 'error',
            'error': f"Failed to retrieve video metadata for download: {str(e)}"
        })
        return

    # Set output template: downloads/{download_id}.%(ext)s
    outtmpl = os.path.join(DOWNLOAD_DIR, f'{download_id}.%(ext)s')
    
    cmd = [
        YT_DLP_BIN,
        '--js-runtimes', 'node',
        '--ffmpeg-location', FFMPEG_EXE,
        '-f', f'bestvideo[height={height}]+bestaudio/best[height={height}]/best',
        '-o', outtmpl,
        '--merge-output-format', 'mp4',
        '--newline',
        '--progress',
        url
    ]
    
    cookies_paths = [
        os.path.join(os.path.dirname(os.path.abspath(__file__)), 'cookies.txt'),
        '/etc/secrets/cookies.txt'
    ]
    cookies_found = False
    for path in cookies_paths:
        if os.path.exists(path):
            fix_cookies_format(path)
            print(f"DEBUG: Found cookies at {path} for download", flush=True)
            cmd.extend(['--cookies', path])
            cookies_found = True
            break
    if not cookies_found:
        print("DEBUG: No cookies.txt found for download", flush=True)
    
    try:
        process = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1,
            universal_newlines=True
        )
        
        # Read stdout line by line
        for line in process.stdout:
            line_str = line.strip()
            if not line_str:
                continue
            
            # Check if merging/merger step has started
            if '[Merger]' in line_str or 'Merging formats' in line_str:
                download_status[download_id].update({
                    'status': 'merging',
                    'progress': 100,
                    'speed': 'Merging...',
                    'eta': 'Almost done'
                })
                continue
                
            match = progress_regex.match(line_str)
            if match:
                progress = float(match.group(1))
                speed = match.group(2).strip()
                eta = match.group(3).strip()
                
                download_status[download_id].update({
                    'status': 'downloading',
                    'progress': progress,
                    'speed': speed,
                    'eta': eta
                })
        
        process.wait()
        
        if process.returncode == 0:
            # Locate output file in downloads directory matching download_id
            expected_filename = f"{download_id}.mp4"
            expected_path = os.path.join(DOWNLOAD_DIR, expected_filename)
            
            if not os.path.exists(expected_path):
                # Search directory for matches
                for f in os.listdir(DOWNLOAD_DIR):
                    if f.startswith(download_id):
                        expected_path = os.path.join(DOWNLOAD_DIR, f)
                        expected_filename = f
                        break
            
            if os.path.exists(expected_path):
                _, ext = os.path.splitext(expected_path)
                display_name = f"{safe_title}{ext}"
                
                download_status[download_id].update({
                    'status': 'finished',
                    'progress': 100,
                    'filename': expected_filename,
                    'display_name': display_name
                })
            else:
                raise Exception("Merged download file could not be found on disk.")
        else:
            raise Exception("yt-dlp finished with a non-zero exit code.")
            
    except Exception as e:
        traceback.print_exc()
        download_status[download_id].update({
            'status': 'error',
            'error': str(e)
        })

@app.route('/')
def index():
    return send_from_directory('static', 'index.html')

@app.route('/static/<path:path>')
def serve_static(path):
    return send_from_directory('static', path)

@app.route('/api/info', methods=['POST'])
def get_video_info():
    data = request.get_json()
    if not data or 'url' not in data:
        return jsonify({'error': 'YouTube URL is required'}), 400
    
    url = data['url']
    
    try:
        info = run_yt_dlp_json(url)
        
        # Extracted details
        title = info.get('title', 'Unknown YouTube Video')
        duration = info.get('duration', 0)
        duration_str = format_time(duration)
        thumbnail = info.get('thumbnail', '')
        uploader = info.get('uploader', 'Unknown Channel')
        
        # Extract and filter unique heights
        formats = info.get('formats', [])
        
        # Find best audio format for file size estimation
        audio_formats = [f for f in formats if f.get('vcodec') == 'none' and f.get('acodec') != 'none']
        best_audio = max(audio_formats, key=lambda x: x.get('tbr') or x.get('filesize') or 0) if audio_formats else None
        best_audio_size = (best_audio.get('filesize') or best_audio.get('filesize_approx') or 0) if best_audio else 0
        
        # Group formats by height (resolutions)
        height_map = {}
        for f in formats:
            if f.get('vcodec') != 'none' and f.get('height'):
                h = f.get('height')
                # Keep format with highest bitrate/quality for that height
                if h not in height_map:
                    height_map[h] = f
                else:
                    current = height_map[h]
                    current_val = current.get('tbr') or current.get('filesize') or 0
                    f_val = f.get('tbr') or f.get('filesize') or 0
                    if f_val > current_val:
                        height_map[h] = f
        
        # Build verified quality list
        qualities = []
        for h in sorted(height_map.keys(), reverse=True):
            f = height_map[h]
            
            # Estimate total file size (video format size + best audio format size)
            v_size = f.get('filesize') or f.get('filesize_approx') or 0
            total_size = v_size + best_audio_size
            
            # Fallback to bitrate calculation if size is missing
            if total_size == 0 and duration:
                v_tbr = f.get('tbr') or 0
                a_tbr = (best_audio.get('tbr') or 0) if best_audio else 0
                total_size = ((v_tbr + a_tbr) * 1000 * duration) / 8
            
            size_str = format_size(total_size) if total_size > 0 else "Unknown size"
            
            qualities.append({
                'height': h,
                'label': get_quality_label(h),
                'size': total_size,
                'size_str': size_str,
                'ext': 'mp4'
            })
        
        return jsonify({
            'title': title,
            'duration': duration_str,
            'thumbnail': thumbnail,
            'uploader': uploader,
            'qualities': qualities
        })
        
    except Exception as e:
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500

@app.route('/api/download', methods=['POST'])
def start_download():
    data = request.get_json()
    if not data or 'url' not in data or 'height' not in data:
        return jsonify({'error': 'URL and height are required'}), 400
    
    url = data['url']
    try:
        height = int(data['height'])
    except ValueError:
        return jsonify({'error': 'Invalid height format'}), 400
        
    download_id = str(uuid.uuid4())
    
    # Start thread
    thread = threading.Thread(target=download_video_task, args=(url, height, download_id))
    thread.daemon = True
    thread.start()
    
    return jsonify({
        'status': 'started',
        'download_id': download_id
    })

@app.route('/api/progress/<download_id>')
def get_progress(download_id):
    status_info = download_status.get(download_id)
    if not status_info:
        return jsonify({'status': 'not_found'}), 404
    return jsonify(status_info)

@app.route('/api/files/<filename>')
def serve_file(filename):
    display_name = request.args.get('name', filename)
    return send_from_directory(DOWNLOAD_DIR, filename, as_attachment=True, download_name=display_name)

# --- ClipCut Endpoints and Task Worker ---

def run_clipcut_task(url, clip_length, crop_9_16, skip_start, skip_end, job_id, duration):
    job_dir = os.path.join(CLIPCUT_DIR, job_id)
    os.makedirs(job_dir, exist_ok=True)
    
    clipcut_jobs[job_id] = {
        'status': 'downloading',
        'progress': 0,
        'current_step': 'Initializing video download...',
        'clips': [],
        'error': None,
        'timestamp': time.time()
    }
    
    # Download path
    outtmpl = os.path.join(job_dir, 'full.%(ext)s')
    
    cmd = [
        YT_DLP_BIN,
        '--js-runtimes', 'node',
        '--ffmpeg-location', FFMPEG_EXE,
        '-f', 'bestvideo+bestaudio/best',
        '-o', outtmpl,
        '--merge-output-format', 'mp4',
        '--newline',
        '--progress',
        url
    ]
    
    cookies_paths = [
        os.path.join(os.path.dirname(os.path.abspath(__file__)), 'cookies.txt'),
        '/etc/secrets/cookies.txt'
    ]
    for path in cookies_paths:
        if os.path.exists(path):
            fix_cookies_format(path)
            cmd.extend(['--cookies', path])
            break
            
    try:
        # Run process
        process = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1,
            universal_newlines=True
        )
        
        # Read stdout line by line
        for line in process.stdout:
            line_str = line.strip()
            if not line_str:
                continue
                
            if '[Merger]' in line_str or 'Merging formats' in line_str:
                clipcut_jobs[job_id].update({
                    'status': 'downloading',
                    'progress': 99,
                    'current_step': 'Merging video & audio streams...'
                })
                continue
                
            match = progress_regex.match(line_str)
            if match:
                progress = float(match.group(1))
                clipcut_jobs[job_id].update({
                    'status': 'downloading',
                    'progress': int(progress * 0.9), # Scale download to 90%
                    'current_step': f"Downloading full video: {progress:.1f}%"
                })
                
        process.wait()
        
        if process.returncode != 0:
            raise Exception("yt-dlp failed to download video.")
            
        # Locate the downloaded file
        full_video_path = None
        for f in os.listdir(job_dir):
            if f.startswith('full.'):
                full_video_path = os.path.join(job_dir, f)
                break
                
        if not full_video_path or not os.path.exists(full_video_path):
            raise Exception("Downloaded video could not be found.")
            
        # Calculate segments
        effective_start = skip_start
        effective_end = duration - skip_end
        
        if effective_end <= effective_start:
            raise Exception("Skip times are greater than or equal to video duration.")
            
        effective_duration = effective_end - effective_start
        import math
        num_segments = math.ceil(effective_duration / clip_length)
        
        clipcut_jobs[job_id].update({
            'status': 'processing',
            'progress': 0,
            'current_step': f"Splitting into {num_segments} clips..."
        })
        
        for i in range(num_segments):
            segment_start_time = effective_start + i * clip_length
            segment_duration = min(clip_length, effective_end - segment_start_time)
            
            output_filename = f"clip_{i+1}.mp4"
            output_clip_path = os.path.join(job_dir, output_filename)
            
            clipcut_jobs[job_id].update({
                'current_step': f"Processing clip {i+1} of {num_segments} ({int(segment_duration)}s)...",
                'progress': int((i / num_segments) * 100)
            })
            
            # Crop vs Stream Copy
            if crop_9_16:
                # Center crop to 9:16 vertical (forcing dimensions divisible by 2)
                ffmpeg_cmd = [
                    FFMPEG_EXE, '-y',
                    '-ss', str(segment_start_time),
                    '-i', full_video_path,
                    '-t', str(segment_duration),
                    '-vf', 'crop=2*trunc(ih*9/32):2*trunc(ih/2)',
                    '-c:v', 'libx264',
                    '-preset', 'superfast',
                    '-crf', '23',
                    '-c:a', 'aac',
                    output_clip_path
                ]
            else:
                # Stream copy (super fast)
                ffmpeg_cmd = [
                    FFMPEG_EXE, '-y',
                    '-ss', str(segment_start_time),
                    '-i', full_video_path,
                    '-t', str(segment_duration),
                    '-c', 'copy',
                    output_clip_path
                ]
                
            # Run FFmpeg
            ffmpeg_res = subprocess.run(ffmpeg_cmd, capture_output=True, text=True)
            if ffmpeg_res.returncode != 0:
                print(f"FFmpeg error: {ffmpeg_res.stderr}")
                raise Exception(f"Failed to generate clip {i+1}.")
                
            # Extract thumbnail at 1s mark
            output_thumb_name = f"clip_{i+1}.jpg"
            output_thumb_path = os.path.join(job_dir, output_thumb_name)
            ffmpeg_thumb_cmd = [
                FFMPEG_EXE, '-y',
                '-ss', '1',
                '-i', output_clip_path,
                '-vframes', '1',
                '-q:v', '2',
                output_thumb_path
            ]
            subprocess.run(ffmpeg_thumb_cmd, capture_output=True)
            
            # Store details
            size = os.path.getsize(output_clip_path)
            clipcut_jobs[job_id]['clips'].append({
                'clip_index': i + 1,
                'filename': output_filename,
                'display_name': f"Short Clip {i+1}.mp4",
                'thumbnail': output_thumb_name,
                'duration': segment_duration,
                'duration_str': format_time(segment_duration),
                'size': size,
                'size_str': format_size(size)
            })
            
        # Clean up full video to free up space
        try:
            os.remove(full_video_path)
        except Exception:
            pass
            
        clipcut_jobs[job_id].update({
            'status': 'finished',
            'progress': 100,
            'current_step': 'All clips processed successfully!'
        })
        
    except Exception as e:
        traceback.print_exc()
        clipcut_jobs[job_id].update({
            'status': 'error',
            'error': str(e),
            'current_step': f"Error: {str(e)}"
        })

@app.route('/api/clipcut/info', methods=['POST'])
def clipcut_info():
    data = request.get_json()
    if not data or 'url' not in data:
        return jsonify({'error': 'YouTube URL is required'}), 400
    
    url = data['url']
    try:
        info = run_yt_dlp_json(url)
        title = info.get('title', 'Unknown YouTube Video')
        duration = info.get('duration', 0)
        duration_str = format_time(duration)
        thumbnail = info.get('thumbnail', '')
        uploader = info.get('uploader', 'Unknown Channel')
        
        # Get max height
        formats = info.get('formats', [])
        max_height = 0
        fps = 30
        for f in formats:
            if f.get('vcodec') != 'none' and f.get('height'):
                max_height = max(max_height, f.get('height'))
                if f.get('fps'):
                    fps = max(fps, int(f.get('fps')))
        
        if max_height == 0:
            max_height = info.get('height') or 360
            
        is_low_res = max_height < 720
        
        return jsonify({
            'title': title,
            'duration': duration,
            'duration_str': duration_str,
            'thumbnail': thumbnail,
            'uploader': uploader,
            'height': max_height,
            'fps': fps,
            'is_low_res': is_low_res
        })
    except Exception as e:
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500

@app.route('/api/clipcut/process', methods=['POST'])
def clipcut_process():
    data = request.get_json()
    if not data or 'url' not in data:
        return jsonify({'error': 'URL is required'}), 400
        
    url = data['url']
    clip_length = int(data.get('clip_length', 60))
    crop_9_16 = bool(data.get('crop_9_16', False))
    skip_start = int(data.get('skip_start', 0))
    skip_end = int(data.get('skip_end', 0))
    duration = int(data.get('duration', 0))
    
    if duration <= 0:
        return jsonify({'error': 'Invalid video duration'}), 400
        
    job_id = str(uuid.uuid4())
    
    # Start thread
    thread = threading.Thread(
        target=run_clipcut_task,
        args=(url, clip_length, crop_9_16, skip_start, skip_end, job_id, duration)
    )
    thread.daemon = True
    thread.start()
    
    return jsonify({
        'status': 'started',
        'job_id': job_id
    })

@app.route('/api/clipcut/status/<job_id>')
def clipcut_status(job_id):
    status_info = clipcut_jobs.get(job_id)
    if not status_info:
        return jsonify({'status': 'not_found'}), 404
    return jsonify(status_info)

@app.route('/api/clipcut/download/<job_id>/<filename>')
def serve_clipcut_file(job_id, filename):
    # Security validation
    if not re.match(r'^clip_\d+\.(mp4|jpg)$', filename):
        return jsonify({'error': 'Invalid file request'}), 400
        
    job_dir = os.path.join(CLIPCUT_DIR, job_id)
    return send_from_directory(job_dir, filename, as_attachment=filename.endswith('.mp4'))

@app.route('/api/clipcut/download-zip/<job_id>')
def serve_clipcut_zip(job_id):
    job_dir = os.path.join(CLIPCUT_DIR, job_id)
    if not os.path.exists(job_dir):
        return jsonify({'error': 'Job not found'}), 404
        
    zip_filename = f"clips_{job_id}.zip"
    zip_path = os.path.join(job_dir, zip_filename)
    
    # Generate ZIP if it doesn't exist
    if not os.path.exists(zip_path):
        with zipfile.ZipFile(zip_path, 'w') as zipf:
            for f in sorted(os.listdir(job_dir)):
                if f.startswith('clip_') and f.endswith('.mp4'):
                    zipf.write(os.path.join(job_dir, f), f)
                    
    return send_from_directory(job_dir, zip_filename, as_attachment=True, download_name="clips.zip")

if __name__ == '__main__':
    app.run(host='127.0.0.1', port=5000, debug=True)
