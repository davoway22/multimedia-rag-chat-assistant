import * as React from "react";
import FileUpload from "@cloudscape-design/components/file-upload";
import FormField from "@cloudscape-design/components/form-field";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { Auth } from 'aws-amplify';
import './FileUploader.css';

const BUCKET_NAME = process.env.REACT_APP_S3_SOURCE;

// Constants for validation
const IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp'];
const DOCUMENT_EXTENSIONS = ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'csv'];
const MEDIA_EXTENSIONS = ['mp3', 'mp4', 'wav', 'flac', 'ogg', 'amr', 'webm', 'mov'];
const ALLOWED_FILE_TYPES = [...IMAGE_EXTENSIONS, ...DOCUMENT_EXTENSIONS, ...MEDIA_EXTENSIONS];
const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB

const FileUploader = () => {
  const [value, setValue] = React.useState([]);
  const [uploadStatus, setUploadStatus] = React.useState([]);
  const [uploadProgress, setUploadProgress] = React.useState({});
  const [isUploading, setIsUploading] = React.useState(false);

  // Helper functions
  const getFileExtension = (filename) => {
    if (!filename || typeof filename !== 'string') return '';
    const parts = filename.split('.');
    return parts.length > 1 ? parts.pop().toLowerCase() : '';
  };

  const isAllowedFileType = (filename) => {
    const ext = getFileExtension(filename);
    return ALLOWED_FILE_TYPES.includes(ext);
  };

  const isImageFile = (filename) => {
    const ext = getFileExtension(filename);
    return IMAGE_EXTENSIONS.includes(ext);
  };

  const sanitizeFileName = (fileName) => {
    if (!fileName || typeof fileName !== 'string') return 'unnamed-file';
    
    return fileName
      .replace(/\s+/g, '-')
      .replace(/[^a-zA-Z0-9-_.]/g, '')
      .toLowerCase()
      .replace(/-+/g, '-')
      .replace(/^-+|-+$/g, '');
  };

  const getContentType = (filename, fallbackType = 'application/octet-stream') => {
    const ext = getFileExtension(filename);
    const mimeTypes = {
      // Documents
      pdf: 'application/pdf',
      doc: 'application/msword',
      docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      xls: 'application/vnd.ms-excel',
      xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      ppt: 'application/vnd.ms-powerpoint',
      pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      txt: 'text/plain',
      csv: 'text/csv',
      
      // Images
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      png: 'image/png',
      gif: 'image/gif',
      bmp: 'image/bmp',
      webp: 'image/webp',
      
      // Audio/Video
      mp3: 'audio/mpeg',
      mp4: 'video/mp4',
      wav: 'audio/wav',
      flac: 'audio/flac',
      ogg: 'audio/ogg',
      webm: 'video/webm',
      mov: 'video/quicktime'
    };
    
    return mimeTypes[ext] || fallbackType;
  };

  const uploadFile = async (file, s3Client) => {
    if (!(file instanceof File)) {
      throw new Error('Invalid file object');
    }

    const filename = file.name || 'unnamed-file';
    const fileExt = getFileExtension(filename);
    const nameWithoutExt = filename.lastIndexOf('.') > 0 
      ? filename.slice(0, filename.lastIndexOf('.'))
      : filename;
    const sanitizedFileName = `${sanitizeFileName(nameWithoutExt)}${fileExt ? `.${fileExt}` : ''}`;

    const command = new PutObjectCommand({
      Bucket: BUCKET_NAME,
      Key: sanitizedFileName,
      ContentType: getContentType(filename, file.type),
      ContentLength: file.size,
    });

    try {
      const signedUrl = await getSignedUrl(s3Client, command, { expiresIn: 3600 });
      const xhr = new XMLHttpRequest();
      
      return new Promise((resolve, reject) => {
        xhr.upload.addEventListener('progress', (event) => {
          if (event.lengthComputable) {
            const percentCompleted = Math.round((event.loaded * 100) / event.total);
            setUploadProgress(prev => ({
              ...prev,
              [filename]: percentCompleted
            }));
            
            setUploadStatus(prev => prev.map(status => 
              status.name === filename 
                ? { ...status, message: `⏳ Uploading: ${percentCompleted}%` }
                : status
            ));
          }
        });

        xhr.addEventListener('load', () => {
          if (xhr.status === 200) {
            resolve({ 
              Key: sanitizedFileName,
              Location: signedUrl.split('?')[0]
            });
          } else {
            reject(new Error(`Upload failed with status ${xhr.status}`));
          }
        });

        xhr.addEventListener('error', () => {
          reject(new Error('Upload failed'));
        });

        xhr.open('PUT', signedUrl);
        xhr.setRequestHeader('Content-Type', getContentType(filename, file.type));
        xhr.send(file);
      });
    } catch (error) {
      throw new Error(`Failed to upload file: ${error.message}`);
    }
  };

  const handleFileChange = ({ detail }) => {
    // Filter out invalid files
    const validFiles = detail.value.filter(item => {
      // Basic validation
      if (!(item instanceof File)) return false;
      if (!item.name || typeof item.name !== 'string') return false;
      if (item.size === 0) return false;
      if (item.size > MAX_FILE_SIZE) return false;
      
      // File type validation
      return isAllowedFileType(item.name);
    });
    
    // Show errors for invalid files
    const invalidFiles = detail.value.filter(item => !validFiles.includes(item));
    
    invalidFiles.forEach(file => {
      let errorMsg = 'Invalid file';
      if (!(file instanceof File)) {
        errorMsg = 'Invalid file object';
      } else if (!file.name || typeof file.name !== 'string') {
        errorMsg = 'File has no valid name';
      } else if (file.size === 0) {
        errorMsg = 'File is empty';
      } else if (file.size > MAX_FILE_SIZE) {
        errorMsg = 'File exceeds 50MB limit';
      } else if (!isAllowedFileType(file.name)) {
        errorMsg = `File type not allowed. Allowed types: ${ALLOWED_FILE_TYPES.join(', ')}`;
      }
      
      setUploadStatus(prev => [...prev, {
        name: file.name || 'Unknown file',
        status: 'error',
        message: `❌ ${errorMsg}`
      }]);
    });

    setValue(validFiles);

    if (validFiles.length > 0) {
      handleUpload(validFiles);
    }
  };

  const handleUpload = async (files) => {
    if (!BUCKET_NAME) {
      console.error('S3 bucket name is not configured');
      setUploadStatus(prev => [...prev, {
        name: 'Configuration',
        status: 'error',
        message: '❌ S3 bucket not configured'
      }]);
      return;
    }

    setIsUploading(true);

    setUploadStatus(prev => [
      ...prev,
      ...files.map(file => ({
        name: file.name || 'unnamed-file',
        status: 'queued',
        message: '⏳ Waiting in queue...'
      }))
    ]);

    try {
      const credentials = await Auth.currentCredentials();
      
      const s3Client = new S3Client({
        region: process.env.REACT_APP_AWS_REGION,
        credentials: Auth.essentialCredentials(credentials)
      });

      for (const file of files) {
        const filename = file.name || 'unnamed-file';
        try {
          setUploadStatus(prev => prev.map(status => 
            status.name === filename 
              ? { ...status, status: 'processing', message: '⚙️ Processing...' }
              : status
          ));

          const result = await uploadFile(file, s3Client);
          
          setUploadStatus(prev => prev.map(status => 
            status.name === filename 
              ? {
                  name: filename,
                  sanitizedName: result.Key,
                  status: 'success',
                  message: `✅ Successfully uploaded as ${result.Key}`
                }
              : status
          ));

        } catch (error) {
          console.error(`Upload error for ${filename}:`, error);
          setUploadStatus(prev => prev.map(status => 
            status.name === filename 
              ? {
                  name: filename,
                  status: 'error',
                  message: `❌ Failed to upload: ${error.message}`
                }
              : status
          ));

          setValue(prev => 
            prev.map(item => 
              item.name === filename 
                ? { ...item, status: "error", errorText: error.message }
                : item
            )
          );
        }
      }
    } catch (error) {
      console.error('Credentials error:', error);
      setUploadStatus(prev => [...prev, {
        name: 'Authentication',
        status: 'error',
        message: `❌ Authentication failed: ${error.message}`
      }]);
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <FormField
      label="Upload Files"
      description={`Select files to upload (Max ${MAX_FILE_SIZE/1024/1024}MB per file)`}
    >
      <FileUpload
        onChange={handleFileChange}
        value={value}
        i18nStrings={{
          uploadButtonText: e => e ? "Choose files" : "Choose file",
          dropzoneText: e => e ? "Drop files to upload" : "Drop file to upload",
          removeFileAriaLabel: e => `Remove file ${e + 1}`,
          limitShowFewer: "Show fewer files",
          limitShowMore: "Show more files",
          errorIconAriaLabel: "Error",
          warningIconAriaLabel: "Warning"
        }}
        multiple
        showFileLastModified
        showFileSize
        showFileThumbnail
        tokenLimit={3}
        constraintText={`Allowed types: ${ALLOWED_FILE_TYPES.join(', ')}`}
        loading={isUploading}
      />

      {uploadStatus.length > 0 && (
        <div className="upload-status-list">
          {uploadStatus.map((status, index) => (
            <div 
              key={index} 
              className={`upload-status-item ${status.status}`}
            >
              <div className="file-name">{status.name}</div>
              <div className="status-message">{status.message}</div>
              {uploadProgress[status.name] !== undefined && status.status === 'processing' && (
                <div className="progress-bar-container">
                  <div 
                    className="progress-bar" 
                    style={{width: `${uploadProgress[status.name]}%`}}
                  />
                  <span className="progress-text">
                    {uploadProgress[status.name]}%
                  </span>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </FormField>
  );
};

export default FileUploader;