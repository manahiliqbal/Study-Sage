const socket = io.connect(window.location.origin);
const chatbox = document.getElementById("chatbox");
const popup = document.getElementById("popup");
const popupMessage = document.getElementById("popup-message");
const popupCloseBtn = document.getElementById("popup-close-btn");
const questionInput = document.getElementById("question");

// Speech Recognition setup
let recognition = null;
let isListening = false;
let lastInputType = 'text'; // Track whether the last input was text or voice

// Explicitly check and request microphone permission
function checkMicrophonePermission() {
    return navigator.permissions.query({ name: 'microphone' })
        .then(permissionStatus => {
            if (permissionStatus.state === 'granted') {
                return true;
            } else {
                return navigator.mediaDevices.getUserMedia({ audio: true })
                    .then(stream => {
                        stream.getTracks().forEach(track => track.stop());
                        showPopup("Microphone access granted!");
                        return true;
                    })
                    .catch(error => {
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
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition || window.mozSpeechRecognition || window.msSpeechRecognition;
    
    if (!SpeechRecognition) {
        showPopup("Speech recognition is not supported in your browser. Try Chrome, Edge, or Safari.");
        return false;
    }
    
    try {
        recognition = new SpeechRecognition();
        recognition.continuous = false;
        recognition.interimResults = true;
        recognition.maxAlternatives = 1;
        recognition.lang = navigator.language || 'en-US';
        
        recognition.onstart = () => {
            isListening = true;
            document.getElementById("voice-button").classList.add('listening');
        };
        
        recognition.onresult = (event) => {
            const speechResult = event.results[event.results.length - 1];
            const transcript = speechResult[0].transcript.trim();
            
            if (transcript) {
                const questionInput = document.getElementById("question");
                questionInput.value = transcript;
                lastInputType = 'voice';
                questionInput.classList.add('voice-input');
                setTimeout(() => { questionInput.classList.remove('voice-input'); }, 1000);
                questionInput.style.backgroundColor = '#e6f7ff';
                setTimeout(() => { questionInput.style.backgroundColor = ''; }, 1000);
            }
        };
        
        recognition.onend = () => {
            toggleVoiceRecognition(false);
            const questionInput = document.getElementById("question");
            if (questionInput.value.trim()) {
                askQuestion();
            }
        };
        
        recognition.onerror = (event) => {
            switch(event.error) {
                case 'no-speech':
                    showPopup("No speech detected.");
                    break;
                case 'audio-capture':
                    showPopup("No microphone found.");
                    break;
                case 'not-allowed':
                    showPopup("Microphone access was denied.");
                    break;
                default:
                    showPopup(`Error: ${event.error}`);
            }
            toggleVoiceRecognition(false);
        };
        
        return true;
    } catch (error) {
        showPopup("Could not initialize speech recognition.");
        return false;
    }
}

// Enhanced Voice Recognition Toggle
async function toggleVoiceRecognition(forcedState = null) {
    const newState = forcedState !== null ? forcedState : !isListening;
    const voiceButton = document.getElementById("voice-button");
    
    if (newState) {
        try {
            const permissionStatus = await navigator.permissions.query({ name: 'microphone' });
            
            if (permissionStatus.state === 'granted') {
                recognition.start();
            } else {
                const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
                stream.getTracks().forEach(track => track.stop());
                recognition.start();
            }
            
            showPopup("Listening... Speak now.");
        } catch (error) {
            showPopup("Could not access microphone. Check permissions.");
        }
    } else {
        try {
            recognition.stop();
        } catch (error) {
            console.error("Error stopping speech recognition:", error);
        }
        isListening = false;
        voiceButton.classList.remove('listening');
    }
}

// Regex to detect URLs
const urlRegex = /(https?:\/\/[^\s]+)/g;


// Function to process the response and replace URLs with anchor tags
function formatLinks(response) {
    return response.replace(urlRegex, (url) => {
        return `<a href="${url}" class="pretty-link" target="_blank">Source: ${url}</a>`;
    });
}

function formatMessageContent(content) {
    // Safely handle HTML content
    const div = document.createElement('div');
    div.innerHTML = content;

    // Process code blocks
    div.querySelectorAll('pre code').forEach(block => {
        const pre = block.parentElement;
        const language = block.className.match(/language-(\w+)/)?.[1] || '';
        if (language) {
            pre.className = `language-${language}`;
        }
    });

    // Ensure citations are formatted correctly without adding breaks
    const citations = div.querySelectorAll('.pdf-citation, .web-citation');
    const uniqueCitations = new Set(); // Use a Set to track unique citations

    citations.forEach(citation => {
        const citationText = citation.innerText; // Get the citation text
        if (!uniqueCitations.has(citationText)) {
            uniqueCitations.add(citationText); // Add to the Set if it's unique
            citation.style.display = 'inline'; // Ensure citations are inline
        } else {
            citation.style.display = 'none'; // Hide duplicate citations
        }
    });

    // Format links
    const formattedContent = formatLinks(div.innerHTML);
    return formattedContent;
}

function addMessage(content, isUser = false) {
    const template = document.getElementById('message-template').content.cloneNode(true);
    const messageDiv = template.querySelector('.message');
    const messageContent = template.querySelector('.message-content');
    const messageInfo = template.querySelector('.message-info');
    const time = template.querySelector('.time');
    
    // Add appropriate classes
    messageDiv.classList.add(isUser ? 'user-message' : 'assistant-message');
    
    // Format and set message content
    messageContent.innerHTML = formatMessageContent(content);
    
    // Set sender and time
    const sender = template.querySelector('.sender');
    sender.textContent = isUser ? 'You' : 'Assistant';
    time.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    
    // Add to chatbox
    chatbox.appendChild(template);
    chatbox.scrollTop = chatbox.scrollHeight;
}

function askQuestion() {
    let question = questionInput.value.trim();
    if (question === '') return;

    // Add user's question to chat
    addMessage(question, true);
    
    // Clear input
    questionInput.value = '';

    // Generate a message ID for this query
    const messageId = `msg-${Date.now()}`;

    // Send question to server
    socket.emit('ask_question', {
        question: question,
        id: messageId,
        input_type: lastInputType
    });
}

// Function to play audio
function playAudio(audioUrl) {
    let audioPlayer = document.getElementById('response-audio');
    if (!audioPlayer) {
        audioPlayer = document.createElement('audio');
        audioPlayer.id = 'response-audio';
        audioPlayer.controls = false;
        document.body.appendChild(audioPlayer);
    }
    
    audioPlayer.src = audioUrl;
    audioPlayer.play().catch(e => {
        showPopup("Could not play audio response.");
    });
}

// Function to create an audio player element
function createAudioPlayer(messageId, audioUrl) {
    const audioContainer = document.createElement('div');
    audioContainer.className = 'audio-controls';
    
    const playButton = document.createElement('button');
    playButton.className = 'play-button';
    playButton.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>';
    playButton.title = "Play response";
    playButton.onclick = () => playAudio(audioUrl);
    
    audioContainer.appendChild(playButton);
    return audioContainer;
}

// Show the popup with the specified message
function showPopup(message) {
    popupMessage.textContent = message;
    popup.style.display = "block";
    
    // Auto-hide popup after 5 seconds
    setTimeout(() => {
        popup.style.display = "none";
    }, 5000);
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

// Socket event handlers
socket.on('connect', () => {
    console.log('Connected to server');
});

socket.on('response_start', (data) => {
    // Initialize the message when the response starts
    addMessage('', false);
});

socket.on('response_chunk', (data) => {
    const messages = chatbox.querySelectorAll('.message');
    const lastMessage = messages[messages.length - 1];
    if (lastMessage && lastMessage.classList.contains('assistant-message')) {
        const messageContent = lastMessage.querySelector('.message-content');
        if (messageContent) {
            // Accumulate content and reformat
            messageContent.innerHTML += data.chunk;
            chatbox.scrollTop = chatbox.scrollHeight;
        }
    }
});

socket.on('response_end', (data) => {
    // Response is complete, ensure scrolled to bottom
    chatbox.scrollTop = chatbox.scrollHeight;
});

socket.on('error', (data) => {
    addMessage(`Error: ${data.error}`, false);
});

// Initialize speech recognition and set up event listeners on page load
document.addEventListener('DOMContentLoaded', function () {
    // Initialize speech recognition
    if (!recognition) {
        initSpeechRecognition();
    }
    
    // Add voice button to the UI if needed
    const inputWrapper = document.querySelector('.input-wrapper');
    if (inputWrapper && !document.getElementById('voice-button')) {
        const voiceButton = document.createElement('button');
        voiceButton.id = 'voice-button';
        voiceButton.className = 'voice-button';
        voiceButton.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path><path d="M19 10v2a7 7 0 0 1-14 0v-2"></path><line x1="12" y1="19" x2="12" y2="23"></line><line x1="8" y1="23" x2="16" y2="23"></line></svg>';
        voiceButton.title = "Voice input";
        voiceButton.onclick = () => {
            toggleVoiceRecognition();
        };
        inputWrapper.appendChild(voiceButton);
    }
    
    // Set up event listeners for the send button
    const sendButton = document.getElementById('send-button');
    if (sendButton) {
        sendButton.addEventListener('click', askQuestion);
    }
    
    // Set up event listener for the PDF upload button
    const uploadButton = document.getElementById('upload-button');
    if (uploadButton) {
        uploadButton.addEventListener('click', uploadPDF);
    }
    
    // Set up event listener for Enter key in the question input
    if (questionInput) {
        questionInput.addEventListener('keypress', function(e) {
            if (e.key === 'Enter') {
                e.preventDefault();
                askQuestion();
            }
        });
    }
});

// Clear chat functionality
document.getElementById('clear-chat').addEventListener('click', function() {
    while (chatbox.firstChild) {
        chatbox.removeChild(chatbox.firstChild);
    }
    // Add welcome message back
    const welcomeMessage = document.createElement('div');
    welcomeMessage.className = 'welcome-message';
    welcomeMessage.innerHTML = `
        <p>I'm your study assistant. Here's how I can help:</p>
        <ul>
        <li><i class="fas fa-file-upload"></i> Upload your study materials (PDFs, docs, or text files)</li>
        <li><i class="fas fa-question-circle"></i> Ask questions about specific topics or concepts</li>
        <li><i class="fas fa-book-open"></i> Get detailed explanations with citations</li>
        <li><i class="fas fa-search"></i> Find relevant sections in your materials</li>
        </ul>
        <p>Start by uploading your study materials above!</p>
    `;
    chatbox.appendChild(welcomeMessage);
});

// Export chat functionality
document.getElementById('export-chat').addEventListener('click', function() {
    let chatContent = '';
    const messages = chatbox.querySelectorAll('.message');
    
    messages.forEach(message => {
        const sender = message.querySelector('.sender').textContent;
        const time = message.querySelector('.time').textContent;
        const content = message.querySelector('.message-content').textContent;
        
        chatContent += `[${time}] ${sender}:\n${content}\n\n`;
    });
    
    if (chatContent === '') {
        chatContent = 'No messages to export.';
    }
    
    const blob = new Blob([chatContent], { type: 'text/plain' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'chat-export.txt';
    a.click();
    window.URL.revokeObjectURL(url);
});

// Mode switching
document.querySelectorAll('.mode-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        // Remove active class from all mode buttons
        document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
        // Add active class to clicked button
        btn.classList.add('active');
        
        // Hide all interfaces
        document.querySelectorAll('.interface-container').forEach(container => {
            container.classList.remove('active');
        });
        
        // Show selected interface
        const mode = btn.dataset.mode;
        document.getElementById(`${mode}-interface`).classList.add('active');
    });
});

// Flashcard functionality
let currentFlashcards = [];
let currentCardIndex = 0;

function generateFlashcards() {
    const formData = new FormData();
    const files = document.getElementById('pdf-upload').files;
    
    if (files.length === 0) {
        showPopup('Please upload study materials first.');
        return;
    }
    
    for (let file of files) {
        formData.append('pdf_files', file);
    }
    
    fetch('/generate_flashcards', {
        method: 'POST',
        body: formData
    })
    .then(response => response.json())
    .then(data => {
        if (data.error) {
            showPopup(data.error);
            return;
        }
        currentFlashcards = data.flashcards;
        currentCardIndex = 0;
        displayFlashcards();
        showPopup('Flashcards generated successfully!');
    })
        .catch(error => {
            console.error('Error:', error);
            showPopup('Error generating flashcards. Please try again.');
        });
}


function displayFlashcards() {
    const flashcardsArea = document.getElementById('flashcards-area');
    if (currentFlashcards.length === 0) {
        flashcardsArea.innerHTML = '<p>No flashcards available. Generate some first!</p>';
        return;
    }
    
    flashcardsArea.innerHTML = ''; // Clear previous content
    const card = currentFlashcards[currentCardIndex];
    
    // Create a flashcard container
    const flashcardContainer = document.createElement('div');
    flashcardContainer.className = 'flashcard-container';
    
    // Set up the inner structure for the flashcard
    flashcardContainer.innerHTML = `
        <div class="flashcard-inner">
            <div class="flashcard-front">${card.front}</div>
            <div class="flashcard-back">${card.back}</div>
        </div>
    `;

    // Add click listener to flip card
    flashcardContainer.addEventListener('click', function () {
        this.querySelector('.flashcard-inner').classList.toggle('flipped');
    });

    // Create navigation buttons
    const flashcardNav = document.createElement('div');
    flashcardNav.className = "flashcard-nav";
    flashcardNav.innerHTML = `
        <button class="nav-btn" onclick="previousCard()" ${currentCardIndex === 0 ? 'disabled' : ''}>Previous</button>       
        <span>${currentCardIndex + 1} / ${currentFlashcards.length}</span>
        <button class="nav-btn" onclick="nextCard()" ${currentCardIndex === currentFlashcards.length - 1 ? 'disabled' : ''}>Next</button>
    `;

    // Append the flashcard and navigation to the area
    flashcardsArea.appendChild(flashcardContainer);
    flashcardsArea.appendChild(flashcardNav);
}

function nextCard() {
    if (currentCardIndex < currentFlashcards.length - 1) {
        currentCardIndex++;
        displayFlashcards();
    }
}

function previousCard() {
    if (currentCardIndex > 0) {
        currentCardIndex--;
        displayFlashcards();
    }
}

function shuffleFlashcards() {
    for (let i = currentFlashcards.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [currentFlashcards[i], currentFlashcards[j]] = [currentFlashcards[j], currentFlashcards[i]];
    }
    currentCardIndex = 0;
    displayFlashcards();
}

// Add event listener for shuffle button
document.getElementById('shuffle-cards').addEventListener('click', shuffleFlashcards);

// Update the processFiles function to handle both modes
function processFiles() {
    const files = document.getElementById('pdf-upload').files;
    if (files.length === 0) {
        showPopup('Please select files to upload.');
        return;
    }
    
    const formData = new FormData();
    for (let file of files) {
        formData.append('pdf_files', file);
    }
    
    fetch('/upload', {
        method: 'POST',
        body: formData
    })
    .then(response => response.json())
    .then(data => {
        if (data.error) {
            showPopup(data.error);
            return;
        }
        showPopup('Materials processed successfully!');
        
    })
    .catch(error => {
        console.error('Error:', error);
        showPopup('Error processing materials. Please try again.');
    });
}                                                                                                                           
