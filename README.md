# Study Sage

An intelligent study assistant that combines the power of Google's Gemini API with web search capabilities to provide comprehensive answers to your questions. The application features a modern web interface with support for both text and voice interactions, along with a flashcard generation system for enhanced learning. Designed specifically for students and researchers, Study Sage helps you process PDF documents, generate study materials, and interact with your content in new ways.

## Features

### PDF Processing
- Upload and process multiple PDF documents
- Intelligent text extraction with page metadata preservation
- Advanced text chunking for optimal processing
- Vector store indexing using FAISS for efficient similarity search

### Interactive Chat Interface
- Real-time chat with streaming responses
- Voice input support with speech recognition
- Text-to-Speech capability for voice responses
- Formatted HTML responses with proper citations
- Combined context from both PDF content and web search results

### Smart Search Integration
- Integration with Google Custom Search for web context
- Intelligent context merging from PDFs and web results
- Properly formatted citations for both PDF and web sources

### Study Tools
- Automatic flashcard generation from PDF content
- Focus on key concepts and relationships
- JSON-formatted flashcard output for easy integration

## Prerequisites

- Python 3.x
- Google API Key for Gemini AI
- Custom Search API Key and Search Engine ID
- Modern web browser with microphone support (for voice features)

## Installation

1. Clone the repository:
```bash
git clone https://github.com/manahiliqbal/study-sage.git
cd study-sage
```

2. Install required packages:
```bash
pip install -r requirements.txt
```

3. Create a `.env` file in the project root with your API keys:
```env
GOOGLE_API_KEY=your_gemini_api_key
API_KEY=your_custom_search_api_key
CSE_ID=your_search_engine_id
SECRET_KEY=your_flask_secret_key
```

## Usage

1. Start the application:
```bash
python app.py
```

2. Open your web browser and navigate to `http://localhost:5000`

3. Upload PDF documents using the interface

4. Start asking questions about your documents

## API Documentation

### PDF Processing Endpoints

#### `POST /upload`
- Uploads and processes PDF files
- Returns success message and processed file names

#### `POST /generate_flashcards`
- Generates flashcards from uploaded PDFs
- Returns JSON array of flashcard objects

### WebSocket Events

#### `ask_question`
- Handles real-time question answering
- Supports both text and voice input
- Streams responses with proper formatting

#### `audio/{filename}`
- Serves generated audio files for voice responses

## Dependencies

- Flask & Flask-SocketIO: Web application framework
- PyPDF2: PDF processing
- Langchain: LLM framework
- Google Generative AI: Gemini integration
- FAISS: Vector similarity search
- gTTS: Text-to-speech conversion
- Additional dependencies listed in `requirements.txt`

## Browser Compatibility

- Chrome (Recommended)
- Edge
- Safari
- Firefox

Note: Voice features require browser support for Web Speech API.

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

This project is licensed under the MIT License - see the LICENSE file for details.