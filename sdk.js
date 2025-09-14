/**
 * Sasake Video SDK
 * 
 * Usage:
 * const sasake = new SasakeSDK({
 *   videoElementId: 'my-video',
 *   avatar: 'sarah'
 * });
 * 
 * await sasake.start(); // Start the AI video chat
 * await sasake.stop();  // Stop and cleanup
 */

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
      
      // Find the video element the user specified
      this.videoElement = document.getElementById(this.config.videoElementId);
      if (!this.videoElement) {
        throw new Error(`Video element with ID '${this.config.videoElementId}' not found`);
      }
    }
    
    /**
     * Make sure the user gave us valid configuration
     */
    validateConfig(config) {
      if (!config.videoElementId) {
        throw new Error('videoElementId is required');
      }
      
      // Set up defaults for anything the user didn't specify
      return {
        videoElementId: config.videoElementId,
        avatar: config.avatar || 'sarah',
        serverUrl: config.serverUrl || this.getDefaultServerUrl(),
        authToken: config.authToken,
        onConnected: config.onConnected || (() => {}),
        onError: config.onError || ((error) => console.error('Sasake SDK Error:', error))
      };
    }
    
    /**
     * Figure out which server to connect to
     */
    getDefaultServerUrl() {
      // If we're testing locally, use local server
      if (window.location.hostname === 'localhost') {
        return 'ws://localhost:7880';
      }
      // Otherwise use the production server
      return 'wss://livekit.tribespot.co';
    }
    
    /**
     * Start the AI video chat
     * This is the main function users will call
     */
    async start() {
      try {
        // Don't start if we're already connected
        if (this.isConnected) {
          console.warn('Already connected');
          return;
        }
        
        // Step 1: Get permission to use the microphone
        await this.requestMicrophonePermission();
        
        // Step 2: Get credentials from the server
        await this.getSessionCredentials();
        
        // Step 3: Connect to the video chat system
        await this.connectToRoom();
        
        // Step 4: Start sending our microphone audio
        await this.startMicrophone();
        
        // Step 5: Tell the server to start the AI conversation
        await this.initializeAICall();
        
        // Mark as connected and tell the user
        this.isConnected = true;
        this.config.onConnected();
        
      } catch (error) {
        // If anything goes wrong, clean up and tell the user
        this.config.onError(error);
        await this.cleanup();
        throw error;
      }
    }
    
    /**
     * Stop the video chat and clean everything up
     */
    async stop() {
      if (!this.isConnected) {
        return;
      }
      
      try {
        // Tell the server we're stopping
        await this.stopAICall();
      } catch (error) {
        console.warn('Error stopping call:', error);
      }
      
      // Clean up all connections
      await this.cleanup();
    }
    
    /**
     * Ask user for permission to use their microphone
     */
    async requestMicrophonePermission() {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          // These settings optimize the audio for speech
          channelCount: 1,      // Mono audio (one channel)
          sampleRate: 16000,    // Good quality for speech
          echoCancellation: true,    // Remove echo
          noiseSuppression: true,    // Remove background noise
          autoGainControl: true      // Adjust volume automatically
        } 
      });
      
      // Stop the temporary stream - we just needed permission
      stream.getTracks().forEach(track => track.stop());
    }
    
    /**
     * Get login credentials from our server
     */
    async getSessionCredentials() {
      const response = await fetch('/token', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.config.authToken}`
        }
      });
      
      if (!response.ok) {
        throw new Error(`Failed to get credentials: ${response.status}`);
      }
      
      const data = await response.json();
      this.sessionId = data.session_id;  // Save our session ID
      this.accessToken = data.token;     // Save our access token
    }
    
    /**
     * Connect to the LiveKit video chat room
     */
    async connectToRoom() {
      // Create a new room connection
      this.room = new LivekitClient.Room();
      
      // Set up what happens when we receive video from the AI
      this.room.on('trackSubscribed', (track, publication, participant) => {
        this.handleIncomingTrack(track, participant);
      });
      
      // Connect to the server using our credentials
      await this.room.connect(this.config.serverUrl, this.accessToken);
    }
    
    /**
     * Handle video/audio coming from the AI
     */
    handleIncomingTrack(track, participant) {
      // Only handle tracks from the AI (they start with 'media-')
      if (!participant.identity.startsWith('media-')) {
        return;
      }
      
      if (track.kind === LivekitClient.Track.Kind.Video) {
        // This is video from the AI - show it in our video element
        const videoStream = new MediaStream([track.mediaStreamTrack]);
        this.videoElement.srcObject = videoStream;
        
      } else if (track.kind === LivekitClient.Track.Kind.Audio) {
        // This is audio from the AI - play it through speakers
        const audioStream = new MediaStream([track.mediaStreamTrack]);
        const audioElement = document.createElement('audio');
        audioElement.srcObject = audioStream;
        audioElement.autoplay = true;
        audioElement.style.display = 'none';  // Hidden audio element
        document.body.appendChild(audioElement);
      }
    }
    
    /**
     * Start sending our microphone to the AI
     */
    async startMicrophone() {
      // Create a microphone track with the same good settings as before
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
      
      // Start sending our audio to the room
      await this.room.localParticipant.publishTrack(this.audioTrack);
    }
    
    /**
     * Tell the server to start the AI conversation
     */
    async initializeAICall() {
      // Get the full configuration for the chosen avatar
      const avatarConfig = this.getAvatarConfig(this.config.avatar);
      
      const response = await fetch('/initialize_call', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.config.authToken}`
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
    
    /**
     * Get the full configuration for an avatar
     */
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
    
    /**
     * Tell the server to stop the AI conversation
     */
    async stopAICall() {
      if (!this.sessionId) {
        return;
      }
      
      const response = await fetch('/stop_call', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.config.authToken}`
        },
        body: JSON.stringify({
          session_id: this.sessionId
        })
      });
      
      // Don't throw errors here - we're cleaning up anyway
      if (!response.ok) {
        console.warn('Failed to stop call on server:', response.status);
      }
    }
    
    /**
     * Clean up all connections and reset everything
     */
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
    
    /**
     * Check if we're currently connected
     */
    isActive() {
      return this.isConnected;
    }
  }