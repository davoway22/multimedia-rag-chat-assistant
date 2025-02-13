import React, { useState, useRef, useEffect, Suspense } from 'react';
import { Auth } from 'aws-amplify';
import { getCloudFrontDomain } from '../config/amplify-config';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import { fromCognitoIdentityPool } from '@aws-sdk/credential-provider-cognito-identity';
import { CognitoIdentityClient } from '@aws-sdk/client-cognito-identity';
import VideoPopover from './VideoPopover-edge';
import FormField from "@cloudscape-design/components/form-field";
import ChatBubble from "@cloudscape-design/chat-components/chat-bubble";
import Avatar from "@cloudscape-design/chat-components/avatar";
import './Chat.css';
import PromptInput from "@cloudscape-design/components/prompt-input";
import { Button } from "@cloudscape-design/components";
import { useGuardrail, useInferenceConfig } from '../context/AppContext';

// Set of valid media extensions
const MEDIA_EXTENSIONS = new Set(['mp3', 'mp4', 'wav', 'flac', 'ogg', 'amr', 'webm', 'mov']);

// Utility function to convert time
const convertTime = (stime) => {
  if (!stime) return '';
  
  // Remove XML tags if present
  const cleanTime = stime.replace(/<\/?timestamp>/g, '');
  
  // Check if the string contains any numbers
  if (!(/\d/.test(cleanTime))) {
    return cleanTime;
  }

  // If cleanTime is not a number, return as is
  if (isNaN(cleanTime)) {
    return cleanTime;
  }

  const totalSeconds = parseInt(cleanTime);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  // If hours > 0, return HH:MM:SS format, otherwise return MM:SS
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
      const actual_extension = filename.split('_').pop().split('.')[0];
      
      if (MEDIA_EXTENSIONS.has(actual_extension)) {
        const formattedTime = convertTime(seconds);
        const result = `|||TIMESTAMP:${seconds}:${formattedTime}:${filename}|||`;
        return result;
      } else {
        return '';
      }
    }
    return match;
  });
};

const getFileUrl = async (filename) => {
  if (filename) {
    const actual_extension = filename.split('_').pop().split('.')[0];
    const baseFileName = filename.split('.')[0].replace(`_${actual_extension}`, '');
    try {
      const session = await Auth.currentSession();
      const token = session.getIdToken().getJwtToken();
      return {
        url: `https://${getCloudFrontDomain()}.cloudfront.net/${baseFileName}.${actual_extension}?auth=${encodeURIComponent(token)}`,
        token: token
      };
    } catch (error) {
      console.error('Error getting authentication token:', error);
      return null;
    }
  }
  return '';
};

const AsyncVideoPopover = ({ filename, seconds, displayTime, getFileUrl }) => {
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
  const [parsedMetadata, setParsedMetadata] = useState({});
  const [copiedMessageId, setCopiedMessageId] = useState(null);
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

  useEffect(() => {
    if (pendingSubmit && input.trim()) {
      handleSubmit();
      setPendingSubmit(false);
    }
  }, [pendingSubmit, input]);

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
    // Cancel any ongoing speech
    window.speechSynthesis.cancel();
  
    const utterance = new SpeechSynthesisUtterance(text);

    utterance.onstart = () => setIsSpeaking(true);
    utterance.onend = () => setIsSpeaking(false);
    utterance.onerror = () => setIsSpeaking(false);
    
    // Optional: Customize the voice settings
    utterance.rate = 1.0;  // Speed of speech (0.1 to 10)
    utterance.pitch = 1.0; // Pitch (0 to 2)
    utterance.volume = 1.0; // Volume (0 to 1)
    
    // Optional: Select a specific voice
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
  
  const handleSubmit = async () => {
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

        // Check for location tags within answer
        let processedAnswer = answerText;
        let locationTags = '';
        if (answerText.includes('<location>')) {
          // Extract location information
          const locationMatch = answerText.match(/<location>(.*?)<\/location>/s);
          if (locationMatch) {
              locationTags = `<location>${locationMatch[1]}</location>`;
              // Remove location tags from the answer
              processedAnswer = answerText.replace(/<location>.*?<\/location>/s, '').trim();
          }
        }
        // Combine metadata with location tags
        const combinedMetadata = locationTags ? `${locationTags}\n${metadataText}` : metadataText;
  
        const metadata = parseMetadata(combinedMetadata.split('\n'));
        setParsedMetadata(metadata);
  
        const parsedAnswer = parseTimestamps(answerText, metadata);
        
        setMessages(prev => [...prev, { 
          role: 'assistant', 
          content: parsedAnswer,
          metadata: metadata
        }]);
      } else {
        // Handle content without answer tags but possibly with location tags
        let processedContent = content;
        if (content.includes('<location>')) {
          // Remove location tags and their content completely
          processedContent = content.replace(/<location>.*?<\/location>/s, '').trim();
        }

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
                    
                    const actual_extension = filename?.split('_').pop().split('.')[0];
                    
                    if (message.metadata && MEDIA_EXTENSIONS.has(actual_extension)) {
                      return (
                        <Suspense fallback={displayTime}>
                          <AsyncVideoPopover
                            key={`inline-${partIndex}`}
                            filename={filename}
                            seconds={parseInt(seconds)}
                            displayTime={displayTime}
                            getFileUrl={getFileUrl}
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
                        const actualExtension = location.split('_').pop().split('.')[0];
                        const baseFileName = location.substring(0, location.lastIndexOf('_'));
                        
                        const tryOpenDocument = async () => {
                          try {
                            const session = await Auth.currentSession();
                            const token = session.getIdToken().getJwtToken();

                            const cloudFrontDomain = getCloudFrontDomain(); 
                            const actualExtension = location.split('_').pop().split('.')[0];
                            const baseFileName = location.substring(0, location.lastIndexOf('_'));

                            const url = `https://${cloudFrontDomain}.cloudfront.net/${baseFileName}.${actualExtension}`;
                            const encodedToken = encodeURIComponent(token);
                            const urlWithAuth = `${url}?auth=${encodedToken}`;
                            
                            // Use only window.open with noopener for security
                            window.open(urlWithAuth, '_blank', 'noopener');
                            
                          } catch (error) {
                            console.error('Error:', error);
                            alert('Error opening content: ' + error.message);
                          }
                        };
                        return (
                          <div key={`content-${metaIndex}`} className="know-more-section">
                            <Button onClick={tryOpenDocument}>
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
