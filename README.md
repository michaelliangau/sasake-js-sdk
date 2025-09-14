# Sasake JavaScript SDK

AI live video chat SDK

## Quick Start

1. **Include the required scripts in your HTML:**

```html
<!-- Required dependency -->
<script src="https://unpkg.com/livekit-client/dist/livekit-client.umd.min.js"></script>
<!-- Sasake SDK -->
<script src="sdk.js"></script>
```

2. **Add a video element:**

```html
<video id="sasake-video" autoplay></video>
```

3. **Initialize and start:**

```javascript
// Initialize Sasake AI SDK
const sasake = new SasakeSDK({
  videoElementId: 'sasake-video',
  avatar: 'sarah'
});

// Start the AI video chat
await sasake.start();

// Stop when done
await sasake.stop();
```

## Configuration Options

```javascript
const sasake = new SasakeSDK({
  // Required
  videoElementId: 'sasake-video',
  avatar: 'sarah',
  authToken: 'YOUR_API_KEY',
  
  // Optional callbacks
  onConnected: () => console.log('Connected!'),
  onError: (error) => console.error('Error:', error)
});
```

## Available Avatars

- **sarah** - Friendly female AI doctor assistant
- **michael** - Professional male AI doctor assistant

## Methods

- `await sasake.start()` - Start the AI video chat
- `await sasake.stop()` - Stop and cleanup everything
- `sasake.isActive()` - Check if currently connected
