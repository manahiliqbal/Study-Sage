from flask import Flask, render_template, request, jsonify, session, send_file
from flask_socketio import SocketIO
from PyPDF2 import PdfReader
import logging
from io import BytesIO
from langchain.text_splitter import RecursiveCharacterTextSplitter
import os
from langchain_google_genai import GoogleGenerativeAIEmbeddings
import google.generativeai as genai
from langchain_community.vectorstores import FAISS
from langchain.docstore.document import Document
from langchain.chains.question_answering import load_qa_chain
from langchain.prompts import PromptTemplate
from dotenv import load_dotenv
import time
import re
from gtts import gTTS
import uuid
import tempfile
import threading
import requests
from langchain.chains import LLMChain
import json
import re

# Configure logging
logging.basicConfig(level=logging.INFO)

# Load environment variables
load_dotenv()
api_key = os.getenv("GOOGLE_API_KEY")
if not api_key:
    raise ValueError("GOOGLE_API_KEY environment variable not set")

custom_api_key = os.getenv("API_KEY")
if not custom_api_key:
    raise ValueError("API_KEY environment variable not set")

cse_id = os.getenv("CSE_ID")
if not cse_id:
    raise ValueError("CSE_ID environment variable not set")

genai.configure(api_key=api_key)

# Initialize Flask app
app = Flask(__name__)
app.secret_key = os.getenv("SECRET_KEY", "default_secret_key")
socketio = SocketIO(app, cors_allowed_origins="*")

# Create a temp directory for audio files if it doesn't exist
AUDIO_DIR = os.path.join(tempfile.gettempdir(), "pdf_assistant_audio")
os.makedirs(AUDIO_DIR, exist_ok=True)

# Function to query Google Custom Search
def google_search(query):
    url = f"https://www.googleapis.com/customsearch/v1?q={query}&key={custom_api_key}&cx={cse_id}"
    response = requests.get(url)
    return response.json()

# Extract text from PDF documents and store page number as metadata
def get_pdf_text(pdf_docs):
    text = ""
    documents_with_metadata = [] 
    for pdf_index, pdf in enumerate(pdf_docs):
        try:
            pdf_reader = PdfReader(BytesIO(pdf))
            for page_number, page in enumerate(pdf_reader.pages, start=1):
                page_text = page.extract_text() or ""
                documents_with_metadata.append((page_text, page_number))
        except Exception as e:
            print(f"Error extracting text from PDF: {e}")
    return documents_with_metadata

def get_text_chunks(documents_with_metadata):
    """Split text into manageable chunks."""
    text_splitter = RecursiveCharacterTextSplitter(chunk_size=1000, chunk_overlap=100)
    text_chunks = []
    
    for text, page_number in documents_with_metadata:
        chunks = text_splitter.split_text(text)
        for chunk in chunks:
            text_chunks.append(Document(page_content=chunk, metadata={"page_number": page_number}))
    
    return text_chunks

def get_vector_store(text_chunks):
    """Create vector store from text chunks."""
    embeddings = GoogleGenerativeAIEmbeddings(model="models/embedding-001")
    vector_store = FAISS.from_documents(text_chunks, embedding=embeddings)
    vector_store.save_local("faiss_index")
    return vector_store

# Function to generate response from Google Search and PDFs
def combined_search_response(user_question):
    """Combines the answers from PDF and Web Search (Google Custom Search)"""
    
    # Get PDF context from FAISS index
    try:
        embeddings = GoogleGenerativeAIEmbeddings(model="models/embedding-001")
        new_db = FAISS.load_local("faiss_index", embeddings)
        docs = new_db.similarity_search(user_question, k=3)
        pdf_context = "\n".join([doc.page_content for doc in docs])
        page_numbers = [doc.metadata.get("page_number", "Unknown") for doc in docs]
        pdf_context_with_pages = "\n".join([f"[Page {page}] {content}" 
                                        for content, page in zip([doc.page_content for doc in docs], page_numbers)])
    except Exception as e:
        pdf_context_with_pages = f"Error retrieving PDF context: {str(e)}"
    
    # Get Web Search Results using Google Custom Search
    try:
        search_results = google_search(user_question)
        web_context = ""
        if 'items' in search_results:
            web_context = "\n".join([f"Title: {item['title']}\nSnippet: {item['snippet']}\nURL: {item['link']}\n"
                                    for item in search_results['items']])
        else:
            web_context = "No relevant results found in web search."    
    except Exception as e:
        web_context = f"Error retrieving web search context: {str(e)}"
    
    # Combine PDF and Web Results without repeating sources
    combined_context = f"PDF Results:\n{pdf_context_with_pages}\n\nWeb Results:\n{web_context}"
    return combined_context

# Function to query Gemini API
def generate_gemini_response(prompt, question):
    """Generates response using Gemini API based on combined context (PDF + Web)."""
    model = genai.GenerativeModel('gemini-1.5-flash')
    response = model.generate_content(
        f"""
        <p>Provide a comprehensive and detailed answer to the user's question using both PDF content and web sources.</p>

        <h3>Key Information</h3>
        <p>For every factual sentence or important chunk of information, include an inline superscript number at the end like this: <sup>1</sup>. Start numbering from 1 and increment as needed. Ensure that each source is only enumerated once.</p>

        <h3>Sources</h3>
        <p>At the end of the response, provide a numbered list of sources that match each superscript number, using the following HTML formats:</p>
        <ul>
            <li>For PDF sources: <span class="pdf-citation">[1] Source: PDF, Page X</span></li>
            <li>For web sources: <span class="web-citation">[2] Source: <a href='[URL]' target="_blank">[URL]</a></span></li>
        </ul>

        <p>If no answer is found from the provided sources, return this exact line:</p>
        <span class="no-answer">The answer is not available in the provided context.</span>

        <h3>Formatting Guidelines</h3>
        <p>Keep the output clean and readable, and ensure all links and formatting are valid HTML.</p>

        <h3>Context</h3>
        <p>{prompt}</p>
        
        <h3>Question</h3>
        <p>{question}</p>
        """,
        stream=True
    )
    return response

# Function to generate audio from text
def generate_audio(text, message_id):
    try:
        # Generate a unique filename
        filename = f"{message_id}.mp3"
        filepath = os.path.join(AUDIO_DIR, filename)
        
        # Create TTS audio file
        tts = gTTS(text=text, lang='en', slow=False)
        tts.save(filepath)
        
        # Return the URL path to the audio file
        return f"/audio/{filename}", filepath
    except Exception as e:
        print(f"Error generating audio: {e}")
        return None, None

# Flashcard generation prompt
FLASHCARD_PROMPT = PromptTemplate(
    input_variables=["text"],
    template="""
    Create a set of flashcards from the following text. Each flashcard should have a question/prompt on the front and the answer on the back.
    Focus on key concepts, definitions, and important relationships. Make the cards concise but comprehensive.
    Format your response as a JSON array of objects, each with 'front' and 'back' properties.
    
    Text: {text}
    
    Response (in JSON format):
    """
)

def generate_flashcards_from_text(text):
    """Generate flashcards from the given text using Gemini."""
    try:
        model = genai.GenerativeModel('gemini-1.5-flash')
        prompt = FLASHCARD_PROMPT.format(text=text)
        response = model.generate_content(prompt).text
        logging.info(f"Raw LLM Response: {response}")

        try:
            # Attempt to extract JSON from the response
            json_start = response.find('[')
            json_end = response.rfind(']')
            if json_start != -1 and json_end != -1:
                json_str = response[json_start:json_end+1]
            else:
                json_str = response  # Try parsing the whole string if no brackets are found
            
            flashcards = json.loads(json_str)

            if not isinstance(flashcards, list) or not all(isinstance(card, dict) and 'front' in card and 'back' in card for card in flashcards):
                logging.error(f"Flashcards not in the expected format after parsing: {flashcards}")
                raise ValueError("Flashcards not in the expected format")
            
            logging.info(f"Parsed Flashcards: {flashcards}")
            return flashcards

        except json.JSONDecodeError as e:
            logging.error(f"JSON Decode Error: {e}")
            logging.error(f"Response that caused the error: {response}")
            raise ValueError(f"Invalid JSON format in response: {e}") from e

    except ValueError as ve:
            logging.error(f"ValueError generating flashcards: {ve}")
            return []

    except Exception as e:
        logging.error(f"Error generating flashcards: {e}")
        return []  

# Routes
@app.route('/')
def home():
    """Render the home page."""
    return render_template('index.html')

@app.route('/audio/<filename>')
def get_audio(filename):
    """Serve audio files."""
    try:
        filepath = os.path.join(AUDIO_DIR, filename)
        return send_file(filepath, mimetype='audio/mp3')
    except Exception as e:
        return jsonify({"error": f"Audio file not found: {str(e)}"}), 404

@app.route('/upload', methods=['POST'])
def upload_pdf():
    """Handle PDF upload and processing."""
    if 'pdf_files' not in request.files:
        return jsonify({"error": "No file part"}), 400
    
    files = request.files.getlist('pdf_files')
    if not files or files[0].filename == '':
        return jsonify({"error": "No file selected"}), 400
    
    try:
        # Read PDFs and process them
        pdf_docs = [file.read() for file in files if file.filename.lower().endswith('.pdf')]
        if not pdf_docs:
            return jsonify({"error": "No valid PDF files found"}), 400
        
        # Extract text and page number information
        documents_with_metadata = get_pdf_text(pdf_docs)
        
        # If no text is extracted
        if not any(doc[0].strip() for doc in documents_with_metadata):
            return jsonify({"error": "No text extracted from PDFs"}), 400
        
        # Get text chunks with metadata (page number)
        text_chunks = get_text_chunks(documents_with_metadata)
        
        # Store the embeddings in the vector store
        get_vector_store(text_chunks)
        
        # Store filenames for reference
        file_names = [file.filename for file in files if file.filename.lower().endswith('.pdf')]
        session['uploaded_files'] = file_names
        
        return jsonify({"message": "PDF uploaded and processed successfully!", "files": file_names})
    
    except Exception as e:
        return jsonify({"error": f"An error occurred: {str(e)}"}), 500

@socketio.on('ask_question')
def handle_question(data):
    """Handle questions via Socket.IO with streaming response."""
    try:
        user_question = data.get('question')
        message_id = data.get('id', f'msg-{uuid.uuid4()}')
        input_type = data.get('input_type', 'text')
        
        if not user_question:
            socketio.emit('error', {'error': 'No question provided'})
            return
        
        # Signal the start of response
        socketio.emit('response_start', {'id': message_id, 'input_type': input_type})
        
        # Generate combined context (PDF + Web)
        combined_context = combined_search_response(user_question)
        
        # Generate response from Gemini API
        try:
            response_stream = generate_gemini_response(combined_context, user_question)
            
            # Buffer for accumulating text
            full_response = ""
            
            # Stream response text
            for chunk in response_stream:
                if chunk.text:
                    full_response += chunk.text
                    
                    # Stream in chunks
                    socketio.emit('response_chunk', {'chunk': chunk.text, 'id': message_id})
            
            socketio.emit('response_end', {'response': full_response, 'id': message_id, 'input_type': input_type})
            
            # Generate audio if input was voice
            if input_type == 'voice':
                audio_url, _ = generate_audio(full_response, message_id)
                if audio_url:
                    socketio.emit('audio_response', {
                        'id': message_id,
                        'audio_url': audio_url,
                        'text_content': full_response
                    })
        except Exception as e:
            socketio.emit('error', {'error': f"Error generating response: {str(e)}"})
    
    except Exception as e:
        socketio.emit('error', {'error': f"An error occurred: {str(e)}"})

@app.route('/generate_flashcards', methods=['POST'])
def generate_flashcards():
    """Generate flashcards from uploaded PDFs."""
    if 'pdf_files' not in request.files:
        return jsonify({"error": "No file part"}), 400
    
    files = request.files.getlist('pdf_files')
    if not files or files[0].filename == '':
        return jsonify({"error": "No file selected"}), 400
    
    try:
        # Read PDFs and extract text
        pdf_docs = [file.read() for file in files if file.filename.lower().endswith('.pdf')]
        if not pdf_docs:
            return jsonify({"error": "No valid PDF files found"}), 400
        
        # Extract text from PDFs
        documents_with_metadata = get_pdf_text(pdf_docs)
        
        # Combine all text for flashcard generation
        all_text = "\n".join([doc[0] for doc in documents_with_metadata])
        
        # Generate flashcards
        flashcards = generate_flashcards_from_text(all_text)
        
        return jsonify({
            "flashcards": flashcards,
            "message": "Flashcards generated successfully"
        })
        
    except Exception as e:
        return jsonify({"error": f"Error generating flashcards: {str(e)}"}), 500

if __name__ == "__main__":
    socketio.run(app, debug=True)