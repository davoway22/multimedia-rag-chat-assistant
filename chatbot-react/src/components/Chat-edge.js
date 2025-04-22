import React, { useState, useRef, useEffect, Suspense, useCallback } from 'react';
import { Auth } from 'aws-amplify';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import { fromCognitoIdentityPool } from '@aws-sdk/credential-provider-cognito-identity';
import { CognitoIdentityClient } from '@aws-sdk/client-cognito-identity';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import VideoPopover from './VideoPopover-edge';
import FormField from "@cloudscape-design/components/form-field";
import ChatBubble from "@cloudscape-design/chat-components/chat-bubble";
import Avatar from "@cloudscape-design/chat-components/avatar";
import './Chat.css';
import PromptInput from "@cloudscape-design/components/prompt-input";
import { Button } from "@cloudscape-design/components";
import { useGuardrail, useInferenceConfig } from '../context/AppContext';

// Set of valid media extensions
const MEDIA_EXTENSIONS = new Set(['mp3', 'mp4', 'wav', 'flac', 'ogg', 'amr', 'webm', 'mov', 'pdf']);

// Utility function to convert time
const convertTime = (stime) => {
  if (!stime) return '';
  
  const cleanTime = stime.replace(/<\/?timestamp>/g, '');
  
  if (!(/\d/.test(cleanTime))) {
    return cleanTime;
  }

  if (isNaN(cleanTime)) {
    return cleanTime;
  }

  const totalSeconds = parseInt(cleanTime);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  }
  return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
};

const parseMetadata = (metadataLines) => {
  const parsed = {};
  
  metadataLines.forEach(line => {
    const trimmedLine = line.trim();
    if (trimmedLine.startsWith('<location>')) {
      const location = trimmedLine.replace(/<\/?location>/g, '');
      parsed[location] = []; 
    }
  });

  return parsed;
};

const parseTimestamps = (answer, parsedMetadata) => {
  return answer.replace(/\[(\d+)\s+([^\]]+)\]/g, (match, seconds, filename) => {
    if (Object.keys(parsedMetadata).includes(filename)) {
      console.log('Original filename from metadata:', filename); // Log original filename
      
      // Handle filenames with or without extensions
      const fileParts = filename.split('.');
      let actualExtension, baseName;
      
      if (fileParts.length > 1) {
        // File has an extension
        actualExtension = fileParts.pop();
        baseName = fileParts.join('.');
      } else {
        // File has no extension
        actualExtension = '';
        baseName = filename;
      }
      
      console.log('Parsed filename parts:', { baseName, actualExtension }); // Log parsed parts
      
      if (MEDIA_EXTENSIONS.has(actualExtension.toLowerCase())) {
        const formattedTime = convertTime(seconds);
        const finalFilename = actualExtension ? `${baseName}.${actualExtension}` : baseName;
        console.log('Final filename being used:', finalFilename); // Log final filename
        return `|||TIMESTAMP:${seconds}:${formattedTime}:${finalFilename}|||`;
      }
      return '';
    }
    return match;
  });
};


const getFileUrl = async (filename) => {
  if (!filename) return null;

  // Step 1: Strip .txt
  let cleanName = filename.endsWith('.txt') ? filename.slice(0, -4) : filename;

  // Step 2: Replace _pdf, _mp4, etc. with .pdf, .mp4, etc.
  for (const ext of MEDIA_EXTENSIONS) {
    const suffix = `_${ext.toLowerCase()}`;
    if (cleanName.toLowerCase().endsWith(suffix)) {
      cleanName = cleanName.slice(0, -suffix.length) + `.${ext}`;
      break;
    }
  }

  const key = `Archive/${cleanName}`;
  console.log('Transformed filename:', filename, '→', key);

  try {
    const session = await Auth.currentSession();
    const credentials = fromCognitoIdentityPool({
      client: new CognitoIdentityClient({ 
        region: process.env.REACT_APP_AWS_REGION 
      }),
      identityPoolId: process.env.REACT_APP_IDENTITY_POOL_ID,
      logins: {
        [`cognito-idp.${process.env.REACT_APP_AWS_REGION}.amazonaws.com/${process.env.REACT_APP_USER_POOL_ID}`]: 
          session.getIdToken().getJwtToken()
      }
    });

    const s3Client = new S3Client({ 
      region: 'us-east-1',
      credentials: await credentials()
    });

    const command = new GetObjectCommand({
      Bucket: '975050290062-organized-bucket-chatbot-dev',   //'975050290062-media-bucket-chatbot-dev',
      Key: key
    });

    const url = await getSignedUrl(s3Client, command, { expiresIn: 900 });
    return { url };

  } catch (error) {
    console.error('Error generating presigned URL:', error);
    return null;
  }
};



const AsyncVideoPopover = ({ filename, seconds, displayTime }) => {
  const [videoData, setVideoData] = useState(null);

  useEffect(() => {
    getFileUrl(filename).then(data => {
      if (data) {
        setVideoData(data);
      }
    });
  }, [filename]);

  if (!videoData) return displayTime;

  return (
    <VideoPopover
      videoUrl={videoData.url}
      timestamp={seconds}
      displayTime={displayTime}
    />
  );
};

const Chat = () => {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [pendingSubmit, setPendingSubmit] = useState(false);  
  const messagesEndRef = useRef(null);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const isSpeechSupported = 'speechSynthesis' in window;  
  const { guardrailValue, guardrailVersion } = useGuardrail();
  const { temperature, topP, modelId } = useInferenceConfig();

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSubmit = useCallback(async () => {
    if (!input.trim()) return;

    const userMessage = input.trim();
    setInput(''); 
    setIsLoading(true);

    setMessages(prev => [...prev, { role: 'user', content: userMessage }]);

    try {
      const session = await Auth.currentSession();
      const token = session.getIdToken().getJwtToken();

      const lambda = new LambdaClient({
        region: process.env.REACT_APP_AWS_REGION,
        credentials: fromCognitoIdentityPool({
          client: new CognitoIdentityClient({ 
            region: process.env.REACT_APP_AWS_REGION 
          }),
          identityPoolId: process.env.REACT_APP_IDENTITY_POOL_ID,
          logins: {
            [`cognito-idp.${process.env.REACT_APP_AWS_REGION}.amazonaws.com/${process.env.REACT_APP_USER_POOL_ID}`]: token
          }
        })
      });

      const payload = {
        question: userMessage,
        messages: [{
          role: 'user',
          content: [{ text: userMessage }]
        }],
        guardrailId: guardrailValue,
        guardrailVersion: guardrailVersion,
        temperature: temperature,
        topP: topP,
        modelId: modelId
      };

      const command = new InvokeCommand({
        FunctionName: process.env.REACT_APP_LAMBDA_FUNCTION_NAME,
        Payload: JSON.stringify(payload)
      });

      const response = await lambda.send(command);

      if (response.FunctionError) {
        throw new Error(`Lambda function error: ${response.FunctionError}`);
      }

      const result = JSON.parse(new TextDecoder().decode(response.Payload));

      if (result.statusCode !== 200) {
        throw new Error(`API error: ${result.body}`);
      }

      const content = result.body.answer.content[0].text;

      if (content.includes('</answer>')) {
        const [answerText, metadataText] = content.split('<answer>')[1].split('</answer>');

        let locationTags = '';
        const answerWithoutLocations = answerText.includes('<location>') 
          ? answerText.replace(/<location>.*?<\/location>/s, '').trim()
          : answerText;

        if (answerText.includes('<location>')) {
          const locationMatch = answerText.match(/<location>(.*?)<\/location>/s);
          if (locationMatch) {
            locationTags = `<location>${locationMatch[1]}</location>`;
          }
        }

        const combinedMetadata = locationTags ? `${locationTags}\n${metadataText}` : metadataText;
        const metadata = parseMetadata(combinedMetadata.split('\n'));
        const parsedAnswer = parseTimestamps(answerWithoutLocations, metadata);
        
        setMessages(prev => [...prev, { 
          role: 'assistant', 
          content: parsedAnswer,
          metadata
        }]);
      } else {
        const processedContent = content.includes('<location>') 
          ? content.replace(/<location>.*?<\/location>/s, '').trim()
          : content;

        setMessages(prev => [...prev, { 
          role: 'assistant', 
          content: processedContent 
        }]);
      }
    } catch (error) {
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: `Error: ${error.message}. Please try again.`
      }]);
    } finally {
      setIsLoading(false);
    }
  }, [input, guardrailValue, guardrailVersion, temperature, topP, modelId]);

  useEffect(() => {
    if (pendingSubmit && input.trim()) {
      handleSubmit();
      setPendingSubmit(false);
    }
  }, [pendingSubmit, input, handleSubmit]);

  const startListening = () => {
    if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      const recognition = new SpeechRecognition();
      
      recognition.continuous = false;
      recognition.interimResults = false;
      recognition.lang = 'en-US';
  
      recognition.onstart = () => {
        setIsRecording(true);
      };
  
      recognition.onresult = (event) => {
        const transcript = event.results[0][0].transcript;
        setInput(transcript);
        setTimeout(() => {
          setPendingSubmit(true);
        }, 1500);
      };
  
      recognition.onerror = (event) => {
        setIsRecording(false);
      };
  
      recognition.onend = () => {
        setIsRecording(false);
      };
  
      try {
        recognition.start();
      } catch (error) {
      }
    } else {
      alert('Speech recognition is not supported in this browser.');
    }
  };

  const speak = (text) => {
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);

    utterance.onstart = () => setIsSpeaking(true);
    utterance.onend = () => setIsSpeaking(false);
    utterance.onerror = () => setIsSpeaking(false);
    
    utterance.rate = 1.0;
    utterance.pitch = 1.0;
    utterance.volume = 1.0;
    
    const voices = window.speechSynthesis.getVoices();
    const preferredVoice = voices.find(voice => voice.lang === 'en-US');
    if (preferredVoice) {
      utterance.voice = preferredVoice;
    }

    window.speechSynthesis.speak(utterance);
  };

  const stopSpeaking = () => {
    window.speechSynthesis.cancel();
  };
  
  const openDocument = async (location) => {
    try {
      const fileData = await getFileUrl(location);
      if (fileData?.url) {
        window.open(fileData.url, '_blank', 'noopener');
      } else {
        throw new Error('Failed to generate document URL');
      }
    } catch (error) {
      console.error('Error opening document:', error);
      alert('Error opening content: ' + error.message);
    }
  };

  return (
    <div className="chat-container">
      <div className="messages">
        {messages.map((message, index) => (
          <div key={index}>
            {message.role === 'user' ? (
              <ChatBubble
                type="outgoing"
                avatar={
                  <Avatar
                    ariaLabel="User"
                    tooltipText="User"
                    initials="U"
                  />
                }
              >
                {message.content}
              </ChatBubble>
            ) : (
              <ChatBubble
                type="incoming"
                avatar={
                  <Avatar
                    color="gen-ai"
                    iconName="gen-ai"
                    ariaLabel="Assistant"
                    tooltipText="Assistant"
                  />
                }
              >
                <div className="custom-message-content">
                {message.content.split('|||').map((part, partIndex) => {
                  if (part.startsWith('TIMESTAMP:')) {
                    const content = part.substring('TIMESTAMP:'.length);
                    const firstSplit = content.indexOf(':');
                    const seconds = content.substring(0, firstSplit);
                    const remaining = content.substring(firstSplit + 1);
                    const lastColonIndex = remaining.lastIndexOf(':');
                    const displayTime = remaining.substring(0, lastColonIndex);
                    const filename = remaining.substring(lastColonIndex + 1);
                    
                    console.log('Rendering timestamp with filename:', filename); // Log filename being rendered
                    
                    const fileParts = filename.split('.');
                    const actualExtension = fileParts.length > 1 ? fileParts.pop() : '';
                    const baseName = fileParts.join('.');
                    const fullFilename = actualExtension ? `${baseName}.${actualExtension}` : baseName;
                    
                    if (message.metadata && MEDIA_EXTENSIONS.has(actualExtension.toLowerCase())) {
                      return (
                        <Suspense fallback={displayTime} key={`suspense-${partIndex}`}>
                          <AsyncVideoPopover
                            key={`inline-${partIndex}`}
                            filename={fullFilename}
                            seconds={parseInt(seconds)}
                            displayTime={displayTime}
                          />
                        </Suspense>
                      );
                    }
                    return displayTime;
                  }
                  return <span key={`text-${partIndex}`}>{part}</span>;
                })}
                {message.role === 'assistant' && isSpeechSupported && (
                  <button 
                    onClick={() => isSpeaking ? stopSpeaking() : speak(message.content)}
                    style={{
                      marginLeft: '8px',
                      padding: '4px',
                      background: 'none',
                      border: 'none',
                      cursor: 'pointer'
                    }}
                  >
                    {isSpeaking ? '🔇' : '🔊'}
                  </button>
                )}
                {message.metadata && Object.keys(message.metadata).length > 0 && (
                  <div className="additional-content">
                    {Object.keys(message.metadata).map((location, metaIndex) => {
                      if (location) {
                        return (
                          <div key={`content-${metaIndex}`} className="know-more-section">
                            <Button onClick={() => openDocument(location)}>
                              Know More
                            </Button>
                          </div>
                        );
                      }
                      return null;
                    })}
                  </div>
                )}
                </div>
              </ChatBubble>
            )}
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>
      <div className="input-container">
        <FormField
          stretch={true}
          constraintText={
            <>Character count: {input.length}</>
          }
        >
          <form onSubmit={(e) => {
            e.preventDefault();
            if (input.trim()) {
              handleSubmit();
            }
          }}>
            <div className="input-wrapper">
              <div className="prompt-input-container">
                <PromptInput
                  value={input}
                  onChange={({ detail }) => setInput(detail.value)}
                  placeholder="Ask a question..."
                  disabled={isLoading}
                  loading={isLoading}
                  expandToViewport
                  actionButtonAriaLabel="Send message"
                  actionButtonIconName="send"
                />
              </div>
              <div className="microphone-button-container">
                <Button
                  iconName={isRecording ? "microphone-off" : "microphone"}
                  variant="icon"
                  onClick={startListening}
                  loading={isRecording}
                  disabled={isLoading}
                  ariaLabel={isRecording ? "Stop recording" : "Start recording"}
                />
              </div>
            </div>
          </form>
        </FormField>
      </div>
    </div>
  );
};

export default Chat;