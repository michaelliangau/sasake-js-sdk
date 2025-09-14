class SasakeSDK {
  constructor(config) {
    // Store the user's configuration
    this.config = this.validateConfig(config);
    
    // Internal state - these keep track of what's happening
    this.isConnected = false;
    this.room = null;           // LiveKit room connection
    this.audioTrack = null;     // User's microphone
    this.sessionId = null;      // Unique session ID for this conversation
    this.videoElement = null;   // The HTML video element we'll use
    this.url = "https://sasake.tribespot.co" // The base URL for our server
    
    // Find the video element
    this.videoElement = document.getElementById(this.config.videoElementId);
    if (!this.videoElement) {
      throw new Error(`Video element with ID '${this.config.videoElementId}' not found`);
    }
  }
  
  validateConfig(config) {
    if (!config.videoElementId) {
      throw new Error('videoElementId is required');
    }
    
    return {
      videoElementId: config.videoElementId,
      apiKey: config.apiKey,
      avatar: config.avatar || 'sarah',
      serverUrl: config.serverUrl || this.getLiveKitServerURL(),
      onConnected: config.onConnected || (() => {}),
      onError: config.onError || ((error) => console.error('Sasake SDK Error:', error))
    };
  }
  
  getLiveKitServerURL() {
    if (window.location.hostname === 'localhost') {
      return 'ws://localhost:7880';
    }
    return 'wss://livekit.tribespot.co';
  }
  
  async start() {
    try {
      if (this.isConnected) {
        console.warn('Already connected');
        return;
      }
      await this.getSessionCredentials();
      await this.connectToLiveKitRoom();
      await this.startMicrophone();
      await this.initializeCall();
      this.isConnected = true;
      this.config.onConnected();
    } catch (error) {
      this.config.onError(error);
      await this.cleanup();
      throw error;
    }
  }
  
  async stop() {
    if (!this.isConnected) {
      return;
    }
    
    try {
      await this.stopCall();
    } catch (error) {
      console.warn('Error stopping call:', error);
    }
    await this.cleanup();
  }
  
  async getSessionCredentials() {
    const response = await fetch(this.url + '/token', {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.config.apiKey}`
      }      
    });
    
    if (!response.ok) {
      throw new Error(`Failed to get credentials: ${response.status}`);
    }
    
    const data = await response.json();
    this.sessionId = data.session_id;
    this.accessToken = data.token;
  }
  
  async connectToLiveKitRoom() {
    this.room = new LivekitClient.Room();
    this.room.on('trackSubscribed', (track, publication, participant) => {
      this.handleIncomingTrack(track, participant);
    });
    await this.room.connect(this.config.serverUrl, this.accessToken);
  }
  handleIncomingTrack(track, participant) {
    // Only handle tracks from the server (starts with 'media-')
    if (!participant.identity.startsWith('media-')) {
      return;
    }
    
    if (track.kind === LivekitClient.Track.Kind.Video) {
      // Show video to the user
      const videoStream = new MediaStream([track.mediaStreamTrack]);
      this.videoElement.srcObject = videoStream;
      
    } else if (track.kind === LivekitClient.Track.Kind.Audio) {
      // Play audio to the user
      const audioStream = new MediaStream([track.mediaStreamTrack]);
      const audioElement = document.createElement('audio');
      audioElement.srcObject = audioStream;
      audioElement.autoplay = true;
      audioElement.style.display = 'none';  // Hidden audio element
      document.body.appendChild(audioElement);
    }
  }
  async startMicrophone() {
    this.audioTrack = await LivekitClient.createLocalAudioTrack({
      source: LivekitClient.Track.Source.Microphone,
      audio: {
        sampleRate: 16000,
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      }
    });
    await this.room.localParticipant.publishTrack(this.audioTrack);
  }
  
  async initializeCall() {
    const avatarConfig = this.getAvatarConfig(this.config.avatar);
    const response = await fetch(this.url + '/initialize_call', {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.config.apiKey}`
      },
      body: JSON.stringify({
        ...avatarConfig,
        session_id: this.sessionId
      })
    });
    if (!response.ok) {
      throw new Error(`Failed to start AI call: ${response.status}`);
    }
    const data = await response.json();
    if (!data.success) {
      throw new Error(data.message || 'Failed to initialize AI call');
    }
  }
  
  getAvatarConfig(avatarName) {
    const avatars = {
      sarah: {
        system_prompt: "You are Sarah, a friendly AI doctor assistant. Keep responses conversational and helpful.",
        voice: "Sarah",
        avatar_name: "caucasian_woman_doctor_2"
      },
      michael: {
        system_prompt: "You are Michael, a knowledgeable AI doctor assistant. Provide clear, professional guidance.",
        voice: "Aaron-English", 
        avatar_name: "caucasian_man_doctor_1"
      }
    };
    const config = avatars[avatarName];
    if (!config) {
      throw new Error(`Unknown avatar: ${avatarName}. Available: ${Object.keys(avatars).join(', ')}`);
    }
    return config;
  }
  async stopCall() {
    if (!this.sessionId) {
      return;
    }
    const response = await fetch(this.url + '/stop_call', {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.config.apiKey}`
      },
      body: JSON.stringify({
        session_id: this.sessionId
      })
    });
    if (!response.ok) {
      console.warn('Failed to stop call on server:', response.status);
    }
  }
  async cleanup() {
    this.isConnected = false;
    
    // Stop our microphone
    if (this.audioTrack) {
      this.audioTrack.stop();
      this.audioTrack = null;
    }
    
    // Disconnect from the room
    if (this.room) {
      this.room.disconnect();
      this.room = null;
    }
    
    // Clear the video
    if (this.videoElement.srcObject) {
      this.videoElement.srcObject.getTracks().forEach(track => track.stop());
      this.videoElement.srcObject = null;
    }
    
    // Reset session info
    this.sessionId = null;
    this.accessToken = null;
  }
  
  isActive() {
    return this.isConnected;
  }
}