from flask import Flask, render_template, request, jsonify, session
from flask_socketio import SocketIO
from PyPDF2 import PdfReader
from io import BytesIO
from langchain.text_splitter import RecursiveCharacterTextSplitter
import os
from langchain_google_genai import GoogleGenerativeAIEmbeddings
import google.generativeai as genai
from langchain_community.vectorstores import FAISS
from langchain_google_genai import ChatGoogleGenerativeAI
from langchain.docstore.document import Document
from langchain.chains.question_answering import load_qa_chain
from langchain.prompts import PromptTemplate
from dotenv import load_dotenv
import time
import re

# Load environment variables
load_dotenv()
api_key = os.getenv("GOOGLE_API_KEY")
if not api_key:
    raise ValueError("GOOGLE_API_KEY environment variable not set")

genai.configure(api_key=api_key)

# Initialize Flask app
app = Flask(__name__)
app.secret_key = os.getenv("SECRET_KEY", "default_secret_key")
socketio = SocketIO(app, cors_allowed_origins="*")

def get_pdf_text(pdf_docs):
    """Extract text from PDF documents and store page number as metadata."""
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
    vector_store.save_local("faiss_index2")
    return vector_store

def get_gemini_response_streaming(prompt, question):
    """Get streaming response from Gemini model."""
    model = genai.GenerativeModel('gemini-1.5-flash')
    response = model.generate_content(
        f"""
        Answer the question as detailed as possible from the provided context. 
        If the answer is not available in the context, just say, "answer is not available in the context".
        Provide the page number of the document wherein you found the answer at which has been provided in the chunks as a reference at the end.
        
        You can use basic HTML formatting to make your response more readable:
        - Use <b>bold text</b> for emphasis
        - Use <i>italic text</i> for titles or subtle emphasis
        - Use <u>underlined text</u> for important points
        - Use <ul> and <li> for lists
        - Use <br> for line breaks
        
        Context:
        {prompt}
        
        Question:
        {question}
        """,
        stream=True
    )
    return response

def split_into_words(text):
    """Split text into words and punctuation for word-by-word streaming."""
    # First, preserve complete HTML blocks (like list items with their content)
    html_blocks = re.findall(r'<(ul|ol)>.*?</(ul|ol)>', text, re.DOTALL)
    block_placeholders = {}
    
    for i, match in enumerate(re.finditer(r'<(ul|ol)>.*?</(ul|ol)>', text, re.DOTALL)):
        placeholder = f"HTML_BLOCK_{i}"
        block_placeholders[placeholder] = match.group(0)
        text = text.replace(match.group(0), placeholder)
    
    # Then handle individual HTML tags
    html_tags = re.findall(r'<[^>]+>', text)
    html_placeholders = {}
    
    # Replace HTML tags with placeholders
    for i, tag in enumerate(html_tags):
        placeholder = f"HTML_TAG_{i}"
        html_placeholders[placeholder] = tag
        text = text.replace(tag, placeholder)
    
    # Handle code blocks
    code_blocks = re.findall(r'```[\s\S]*?```', text, re.DOTALL)
    code_placeholders = {}
    
    for i, block in enumerate(code_blocks):
        placeholder = f"CODE_BLOCK_{i}"
        code_placeholders[placeholder] = block
        text = text.replace(block, placeholder)
    
    # Split into words
    parts = re.findall(r'\S+|\s+', text)
    words = []
    
    # Restore placeholders
    for part in parts:
        # Check if this part contains any placeholders
        modified_part = part
        
        # Restore HTML blocks first (they might contain tags)
        for placeholder, original in block_placeholders.items():
            if placeholder in modified_part:
                modified_part = modified_part.replace(placeholder, original)
        
        # Then restore HTML tags
        for placeholder, original in html_placeholders.items():
            if placeholder in modified_part:
                modified_part = modified_part.replace(placeholder, original)
        
        # Finally restore code blocks
        for placeholder, original in code_placeholders.items():
            if placeholder in modified_part:
                modified_part = modified_part.replace(placeholder, original)
        
        words.append(modified_part)
    
    return words

# Routes
@app.route('/')
def home():
    """Render the home page."""
    return render_template('index.html')

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
        
        # Store raw text in session for future use (if needed)
        session['pdf_content'] = [doc[0] for doc in documents_with_metadata]
        
        return jsonify({"message": "PDF uploaded and processed successfully!"})
    
    except Exception as e:
        return jsonify({"error": f"An error occurred: {str(e)}"}), 500
    
# Socket.IO events for streaming responses
@socketio.on('connect')
def handle_connect():
    print('Client connected')

@socketio.on('disconnect')
def handle_disconnect():
    print('Client disconnected')

@socketio.on('ask_question')
def handle_question(data):
    """Handle questions via Socket.IO with streaming response."""
    try:
        user_question = data.get('question')
        if not user_question:
            socketio.emit('error', {'error': 'No question provided'})
            return
        
        try:
            embeddings = GoogleGenerativeAIEmbeddings(model="models/embedding-001")
            new_db = FAISS.load_local("faiss_index2", embeddings)
            docs = new_db.similarity_search(user_question, k=3)
            context = "\n".join([doc.page_content for doc in docs])
        except Exception as e:
            socketio.emit('error', {'error': f"Error retrieving context: {str(e)}"})
            return
        
        # Generate streaming response
        try:
            response_stream = get_gemini_response_streaming(context, user_question)
            
            # Start a new response
            socketio.emit('response_start', {'id': data.get('id', 'default')})
            
            # Buffer for accumulating text to split into words
            text_buffer = ""
            
            # Stream the response chunks
            for chunk in response_stream:
                if chunk.text:
                    text_buffer += chunk.text
                    
                    # When we have enough text or it's the last chunk
                    if len(text_buffer) > 50 or chunk.text.endswith((".", "!", "?", ":", ";", "\n")):
                        # Split buffer into words and stream word by word
                        words = split_into_words(text_buffer)
                        for word in words:
                            socketio.emit('response_chunk', {
                                'id': data.get('id', 'default'),
                                'chunk': word
                            })
                            # Small delay between words for a natural typing effect
                            socketio.sleep(0.05)
                        text_buffer = ""
            
            # Send any remaining text in the buffer
            if text_buffer:
                words = split_into_words(text_buffer)
                for word in words:
                    socketio.emit('response_chunk', {
                        'id': data.get('id', 'default'),
                        'chunk': word
                    })
                    socketio.sleep(0.05)
            
            # Signal end of response
            socketio.emit('response_end', {'id': data.get('id', 'default')})
            
        except Exception as e:
            socketio.emit('error', {'error': f"Error generating response: {str(e)}"})

    except Exception as e:
        socketio.emit('error', {'error': f"An error occurred: {str(e)}"})

if __name__ == "__main__":
    socketio.run(app, debug=True)