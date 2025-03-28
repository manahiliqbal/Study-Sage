const socket = io.connect(window.location.origin);
const chatbox = document.getElementById("chatbox");
const popup = document.getElementById("popup");
const popupMessage = document.getElementById("popup-message");
const popupCloseBtn = document.getElementById("popup-close-btn");
const questionInput = document.getElementById("question");

// Speech Recognition setup
let recognition = null;
let isListening = false;

// Explicitly check and request microphone permission
function checkMicrophonePermission() {
    // First check if we already have permission
    return navigator.permissions.query({name: 'microphone'})
        .then(permissionStatus => {
            console.log("Microphone permission status:", permissionStatus.state);
            
            if (permissionStatus.state === 'granted') {
                return true;
            } else {
                // We need to request permission by actually trying to use the microphone
                return navigator.mediaDevices.getUserMedia({ audio: true })
                    .then(stream => {
                        // Immediately stop all tracks to release the microphone
                        stream.getTracks().forEach(track => track.stop());
                        showPopup("Microphone access granted!");
                        return true;
                    })
                    .catch(error => {
                        console.error("Microphone permission error:", error);
                        showPopup("You need to allow microphone access for voice input to work.");
                        return false;
                    });
            }
        })
        .catch(error => {
            console.error("Permission check failed:", error);
            return false;
        });
}


// Comprehensive Speech Recognition Initialization
function initSpeechRecognition() {
    // Cross-browser speech recognition
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition || window.mozSpeechRecognition || window.msSpeechRecognition;
    
    if (!SpeechRecognition) {
        showPopup("Speech recognition is not supported in your browser. Try Chrome, Edge, or Safari.");
        return false;
    }
    
    try {
        recognition = new SpeechRecognition();
        
        // Configuration for better recognition
        recognition.continuous = false;  // Stop after one speech segment
        recognition.interimResults = true;  // Show partial results
        recognition.maxAlternatives = 1;  // Return most confident result
        recognition.lang = navigator.language || 'en-US';  // Use system language or default to English
        
        // Detailed event handlers
        recognition.onstart = () => {
            isListening = true;
            console.log('Speech recognition started');
            document.getElementById("voice-button").classList.add('listening');
        };
        
        recognition.onresult = (event) => {
            // Get the most recent result
            const speechResult = event.results[event.results.length - 1];
            const transcript = speechResult[0].transcript.trim();
            
            if (transcript) {
                // Update input field with recognized text
                const questionInput = document.getElementById("question");
                questionInput.value = transcript;
                
                // Add visual feedback
                questionInput.classList.add('voice-input');
                setTimeout(() => {
                    questionInput.classList.remove('voice-input');
                }, 1000);
                
                // Optional: Highlight the recognized text briefly
                questionInput.style.backgroundColor = '#e6f7ff';
                setTimeout(() => {
                    questionInput.style.backgroundColor = '';
                }, 1000);
            }
        };
        
        recognition.onend = () => {
            console.log('Speech recognition ended');
            toggleVoiceRecognition(false);
            
            // Auto-submit if text was captured
            const questionInput = document.getElementById("question");
            if (questionInput.value.trim()) {
                askQuestion();
            }
        };
        
        recognition.onerror = (event) => {
            console.error('Speech recognition error:', event.error);
            
            // Detailed error handling
            switch(event.error) {
                case 'no-speech':
                    showPopup("No speech was detected. Try speaking more clearly.");
                    break;
                case 'audio-capture':
                    showPopup("No microphone was found. Check your device connections.");
                    break;
                case 'not-allowed':
                    showPopup("Microphone access was denied. Please check browser permissions.");
                    break;
                default:
                    showPopup(`Speech recognition error: ${event.error}`);
            }
            
            toggleVoiceRecognition(false);
        };
        
        return true;
    } catch (error) {
        console.error('Failed to initialize speech recognition:', error);
        showPopup("Could not initialize speech recognition. Please try a different browser.");
        return false;
    }
}

// Enhanced Voice Recognition Toggle
async function toggleVoiceRecognition(forcedState = null) {
    const newState = forcedState !== null ? forcedState : !isListening;
    const voiceButton = document.getElementById("voice-button");
    
    if (newState) {
        // Ensure microphone permission
        try {
            // Modern permission query
            const permissionStatus = await navigator.permissions.query({ name: 'microphone' });
            
            if (permissionStatus.state === 'granted') {
                // Start recognition
                recognition.start();
            } else {
                // Request permission
                const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
                stream.getTracks().forEach(track => track.stop());
                
                // Retry starting recognition
                recognition.start();
            }
            
            showPopup("Listening... Speak now.");
        } catch (error) {
            console.error("Microphone access error:", error);
            showPopup("Could not access microphone. Check permissions and try again.");
        }
    } else {
        // Stop listening
        try {
            recognition.stop();
        } catch (error) {
            console.error("Error stopping speech recognition:", error);
        }
        
        isListening = false;
        voiceButton.classList.remove('listening');
    }
}

// Add event listener for Enter key in the input field
questionInput.addEventListener("keypress", function (event) {
    if (event.key === "Enter") {
        event.preventDefault();
        askQuestion();
    }
});

// Show the popup with the specified message
function showPopup(message) {
    popupMessage.textContent = message;
    popup.style.display = "block";
}

// Close the popup when the user clicks the close button
popupCloseBtn.onclick = () => {
    popup.style.display = "none";
};

// Handle the PDF upload and notify when processed
function uploadPDF() {
    const pdfInput = document.getElementById("pdf-upload");
    const files = pdfInput.files;

    if (files.length === 0) {
        showPopup("Please select a PDF file to upload.");
        return;
    }

    // Show loading message
    showPopup(`Processing ${files.length} file(s)... Please wait.`);

    const formData = new FormData();
    for (let i = 0; i < files.length; i++) {
        formData.append("pdf_files", files[i]);
    }

    fetch("/upload", {
        method: "POST",
        body: formData,
    })
        .then(response => response.json())
        .then(data => {
            if (data.message) {
                showPopup(data.message);
                const fileCount = files.length;
                const fileNames = Array.from(files).map(file => file.name).join(", ");
                chatbox.innerHTML += `<p><strong>System</strong> Processed ${fileCount} file(s): ${fileNames}</p>`;
                chatbox.scrollTop = chatbox.scrollHeight;
            } else if (data.error) {
                showPopup(`Error: ${data.error}`);
            }
        })
        .catch(error => {
            showPopup("Error uploading PDF.");
            console.error(error);
        });
}

// Handle asking a question to the chatbot
function askQuestion() {
    const userQuestion = questionInput.value.trim();

    if (!userQuestion) {
        return;
    }

    chatbox.innerHTML += `<p><strong>You</strong> ${userQuestion}</p>`;
    chatbox.scrollTop = chatbox.scrollHeight;  // Scroll to the bottom
    questionInput.value = '';

    // Generate unique ID for this message
    const messageId = `msg-${Date.now()}`;

    // Add a bot response container
    chatbox.innerHTML += `<p id="${messageId}"><strong>Assistant</strong> <span id="${messageId}-content"></span><span class="typing-cursor"></span></p>`;
    chatbox.scrollTop = chatbox.scrollHeight;

    // Send the question via socket.io for streaming response
    socket.emit('ask_question', {
        question: userQuestion,
        id: messageId
    });
}

// Socket event listeners for streaming response
socket.on('connect', () => {
    console.log('Connected to server');
});

socket.on('response_start', (data) => {
    const messageElement = document.getElementById(data.id);
    if (messageElement) {
        messageElement.innerHTML = `<strong>Assistant</strong> <span id="${data.id}-content"></span><span class="typing-cursor"></span>`;
    }
});

socket.on('response_chunk', (data) => {
    const contentElement = document.getElementById(`${data.id}-content`);
    if (contentElement) {
        contentElement.innerHTML += data.chunk;
        chatbox.scrollTop = chatbox.scrollHeight;
    }
});

socket.on('response_end', (data) => {
    const messageElement = document.getElementById(data.id);
    if (messageElement) {
        const contentHTML = document.getElementById(`${data.id}-content`).innerHTML;
        messageElement.innerHTML = `<strong>Assistant</strong> ${contentHTML}`;
        chatbox.scrollTop = chatbox.scrollHeight;
    }
});

socket.on('error', (data) => {
    chatbox.innerHTML += `<p><strong>System</strong> <em>Error: ${data.error}</em></p>`;
    chatbox.scrollTop = chatbox.scrollHeight;
});

// Add a direct permission test button to troubleshoot
function createPermissionTestButton() {
    const container = document.querySelector('.container');
    // const testButton = document.createElement('button');
    // testButton.textContent = "Test Microphone Permission";
    // testButton.className = "test-mic-button";
    // testButton.style.marginTop = "10px";
    // testButton.onclick = () => {
    //     showPopup("Requesting microphone permission...");
    //     navigator.mediaDevices.getUserMedia({ audio: true })
    //         .then(stream => {
    //             stream.getTracks().forEach(track => track.stop());
    //             showPopup("Microphone permission granted successfully!");
    //         })
    //         .catch(err => {
    //             showPopup("Failed to get microphone permission: " + err.message);
    //             console.error("Permission error:", err);
    //         });
    // };
    // container.appendChild(testButton);
}

document.addEventListener('DOMContentLoaded', function () {
    // Create test button for direct permission request
    createPermissionTestButton();

    let inputWrapperExists = document.querySelector('.input-wrapper');
    if (!inputWrapperExists) {
        const inputSection = document.querySelector('.input-section');
        const sendButton = document.querySelector('.input-section button');
        
        // Get the original input
        const originalInput = document.getElementById('question');
        
        // Create the wrapper
        const inputWrapper = document.createElement('div');
        inputWrapper.className = 'input-wrapper';
        
        // Move the input to the wrapper
        inputWrapper.appendChild(originalInput);
        
        // Insert the wrapper before the send button
        inputSection.insertBefore(inputWrapper, sendButton);
    }
    
    // Add voice button to the UI
    const inputWrapper = document.querySelector('.input-wrapper');
    const voiceButton = document.createElement('button');
    voiceButton.id = 'voice-button';
    voiceButton.className = 'voice-button';
    voiceButton.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path><path d="M19 10v2a7 7 0 0 1-14 0v-2"></path><line x1="12" y1="19" x2="12" y2="23"></line><line x1="8" y1="23" x2="16" y2="23"></line></svg>';
    voiceButton.title = "Voice input";
    voiceButton.onclick = () => toggleVoiceRecognition();
    inputWrapper.appendChild(voiceButton);
    
    // Add CSS for voice button and input wrapper
    const style = document.createElement('style');
    style.textContent = `
        .input-wrapper {
            display: flex;
            align-items: center;
            flex-grow: 1;
            position: relative;
        }
        
        .voice-button {
            background: none;
            border: none;
            cursor: pointer;
            padding: 8px;
            color: #555;
            border-radius: 50%;
            margin-left: 8px;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: all 0.3s ease;
            position: absolute;
            right: 8px;
        }
        
        .voice-button:hover {
            background-color: #f0f0f0;
        }
        
        .voice-button.listening {
            color: #ff4444;
            background-color: #ffeeee;
            animation: pulse 1.5s infinite;
        }
        
        .voice-input {
            background-color: #e6f7ff !important;
            transition: background-color 0.5s ease;
        }
        
        #question {
            padding-right: 40px;
        }
        
        .compatibility-notice {
            background-color: #fff3cd;
            color: #856404;
            padding: 10px;
            border-radius: 4px;
            margin-top: 10px;
            font-size: 14px;
            text-align: center;
        }
        
        .test-mic-button {
            background-color: #4CAF50;
            color: white;
            border: none;
            padding: 8px 12px;
            border-radius: 4px;
            cursor: pointer;
        }
        
        .test-mic-button:hover {
            background-color: #45a049;
        }
        
        @keyframes pulse {
            0% { transform: scale(1); }
            50% { transform: scale(1.1); }
            100% { transform: scale(1); }
        }
    `;
    document.head.appendChild(style);
    
    // Initialize speech recognition
    initSpeechRecognition();
    
    setTimeout(() => {
        const inputElement = document.getElementById('question');
        if (inputElement) {
            inputElement.focus();
        }
    }, 500);

    // Close popup on clicking outside
    window.onclick = function (event) {
        if (event.target == popup) {
            popup.style.display = "none";
        }
    };
});