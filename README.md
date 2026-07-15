# StreamVault 🌌 - Premium YouTube Video Downloader

StreamVault is a responsive, modern, self-hosted web application that allows you to download YouTube videos in any verified quality format (from 144p up to 4K Ultra HD) with audio merged instantly. It features a premium glassmorphic dark-mode interface and a real-time progress tracking bar.

---

## Key Features

- **Dynamic Quality Verification**: Inspects actual available resolutions for any pasted link. If a video is only available in 1080p, it will not display 4K options.
- **Audio-Video Merger**: Automatically downloads and merges separate video-only and audio-only streams into a single high-quality `.mp4` using bundled static FFmpeg binaries.
- **Real-Time Progress Tracker**: Displays real-time download speed, percentage completion, and ETA.
- **Privacy & Storage Friendly**: Automatically clears temporary downloaded files older than 15 minutes.
- **Responsive Premium Design**: Features obsidian panels, glowing radial backdrops, and interactive animations tailored for both desktop and mobile viewports.

---

## Tech Stack

- **Backend**: Python 3 (Flask)
- **Engine**: Standalone `yt-dlp` macOS binary (forces Node.js for solving signature/cipher challenges)
- **Multimedia Handler**: `imageio-ffmpeg` (provides static FFmpeg binaries for stream merging)
- **Frontend**: HTML5, Vanilla CSS3 (Glassmorphism), Vanilla JavaScript (AJAX & Progress Polling)

---

## Local Setup

### 1. Prerequisites
Ensure you have **Node.js** (required by `yt-dlp` to solve YouTube's signature challenges) and **Python 3** installed on your machine.

### 2. Installation
Clone or download the project files, open a terminal in the project directory, and follow these steps:

1. **Create Python virtual environment**:
   ```bash
   python3 -m venv .venv
   ```
2. **Activate the virtual environment**:
   - macOS / Linux:
     ```bash
     source .venv/bin/activate
     ```
   - Windows:
     ```bash
     .venv\Scripts\activate
     ```
3. **Install python packages**:
   ```bash
   pip install -r requirements.txt
   ```

### 3. Run the App
Start the local server:
```bash
python app.py
```
Open **[http://127.0.0.1:5000](http://127.0.0.1:5000)** in your web browser.

---

## Cloud Deployment

Because StreamVault runs a Python server and utilizes system binaries (`ffmpeg` and `yt-dlp`), it **cannot** be hosted on static platforms like Netlify. Instead, it is configured for containerized deployment platforms (like Render.com or Railway.app).

A pre-configured [Dockerfile](Dockerfile) is included in the project.

### Deploying to Render.com (Free)
1. Push this project to a new **GitHub repository** (ensure `.gitignore` excludes your local `.venv/` folder).
2. Go to [Render.com](https://render.com/) and create a free account.
3. Click **New +** and choose **Web Service**.
4. Link your GitHub account and select your repository.
5. In the settings:
   - Select **Docker** as the Runtime.
   - Select **Free** as the instance type.
6. Click **Create Web Service**. Render will automatically build the container and spin up a public web address for your downloader.

---

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
