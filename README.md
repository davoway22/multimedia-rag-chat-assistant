# Chat with your multimedia content using Amazon Bedrock Data Automation and Amazon Bedrock Knowledge Bases

## Overview
In the era of information overload, extracting meaningful insights from diverse data sources has become increasingly challenging. This becomes particularly difficult when businesses have terabytes of video and audio files, along with text based data and need to quickly access specific sections or topics, summarize content, or answer targeted questions using information sourced from these diverse files without having to switch context or solutions. 
This unified GenAI solution transforms how users interact with their data. This solution seamlessly integrates with various file formats including video, audio PDFs and text documents, providing a unified interface for knowledge extraction. Users can ask questions about their data, and the solution delivers precise answers, complete with source attribution. Responses are linked to their origin, which could include videos that load at the exact timestamp, for faster and efficient referance, PDF files or documents. 

This sample solution will demonstrate how to leverage AWS's AI services to: 
* Process and index multi-format data at scale, including large video, audio and documents 
* Rapidly summarize extensive content from various file types 
* Deliver context-rich responses Provide an unified, intuitive user experience for seamless data exploration

## Deployment Options

This solution uses Amazon Bedrock Data Automation for data parsing and Amazon Bedrock Knowledge Bases for chunking, embedding, retrieval and answer generation.

Amazon Bedrock Data Automation:
  * Manages all content parsing
  * Converts documents, images, video, and audio to text
  
### This implementation is suitable for:
  * Processing text from common text formats, visually rich documents and images.
  * Processing speech to text from audio or video files
  * Processing video files without audio for complete summary and events
  * Processing text within videos
  * Categorizing data within files for efficient search and retrieval 

## Key Storage and Processing Components

### S3 Buckets
- **Media Bucket**: Secure bucket for source files
- **Organized Bucket**: Processed files destination
- **Application Host Bucket**: React frontend host

### Lambda Functions
1. **Initial Processing Lambda**
   - Handles S3 uploads
   - Triggers Bedrock Data Automation

2. **Output Processing Lambda**
   - Processes Bedrock Data Automation results
   - Converts JSON to timestamped text
   - Stores in organized bucket

3. **Retrieval Lambda**
   - Handles user queries
   - Manages context retrieval and response generation

## Parameters

| Parameter | Description | Default/Constraints |
|-----------|-------------|-------------------|
| ModelId | The Amazon Bedrock supported LLM inference profile ID used for inference. | Default: "us.anthropic.claude-3-haiku-20240307-v1:0" |
| EmbeddingModelId | The Amazon Bedrock supported embedding LLM ID used in Bedrock Knowledge Bases. | Default: "amazon.titan-embed-text-v2:0" |
| DataParser | Bedrock Data Automation processes visually rich documents, images, videos and audio and converts to text. | Default: "Bedrock Data Automation"<br>Allowed Values: ["Bedrock Data Automation"] |
| ResourceSuffix | Suffix to append to resource names (e.g., dev, test, prod) | - Alphanumeric characters and hyphens only<br>- Pattern: ^[a-zA-Z0-9-]*$<br>- MinLength: 1<br>- MaxLength: 20 |


## Features
- Automatic media files transcription
- Support for multiple media formats
- Timestamped transcript generation
- User authentication using Amazon Cognito

## Security Features
- IAM roles with least privilege access
- Cognito user pool for authentication
- Cloudfront resource URLs validated using Amazon Lambda@Edge

## Prerequisites
- AWS CLI with credentials
- Node.js and npm
- AWS Console access

# Deployment

## CloudFormation Stack Deployment

### Option A: Via AWS Console
- Upload the template to CloudFormation console [[1]](https://community.aws/content/2bIvnZFA6jzuAK2HmBvnOHu6htb/deploy-your-web-application-with-aws-elastic-beanstalk-aws-cdk-pipelines-and-cloudfront)
- Fill in the required parameters
- Create stack and wait for completion

### Option B: Via AWS CLI
aws cloudformation create-stack \
    --stack-name chatbot-react-stack \
    --template-body file://path/to/template.yaml \
    --capabilities CAPABILITY_IAM \
    --parameters ParameterKey=<key>,ParameterValue=<value>

1. Using the console or CLI, deploy chatbot.yaml template first
2. From the **Outputs** section of the deployed stack, copy **ReactAppUserPoolId**'s value
3. Deploy lambda-edge.yaml template using Cognito User Pool ID obtained from previous step
4. From the **Outputs** section of the lambda-edge.yaml stack, copy **EdgeFunctionVersionARN**'s value

## Amazon CloudFront Configuration

1. Navigate to CloudFront in the AWS Management Console
2. Select the distribution you want to modify
3. Go to the "Behaviors" tab
4. Select the default behavior (Path pattern: Default (*))
5. Click "Edit" button
6. Scroll down to the "Function associations" section
7. For "Origin request", select "Lambda@Edge" as Function type
8. Provide the EdgeFunctionVersionARN obtained from the previous step
9. Scroll to the bottom and click "Save changes"
10. Wait for the distribution to deploy the changes (Status will change from "In Progress" to "Deployed")

## Frontend Configuration
1. Navigate to the chatbot-react folder
2. Create .env file with the following structure:
      `
      REACT_APP_LAMBDA_FUNCTION_NAME=<ReactAppLambdaFunctionName>
      REACT_APP_S3_SOURCE=<ReactAppS3Source>
      REACT_APP_AWS_REGION=<chatbot.yaml_deployment_region>
      REACT_APP_USER_POOL_ID=<ReactAppUserPoolId>
      REACT_APP_USER_POOL_CLIENT_ID=<ReactAppUserPoolClientId>
      REACT_APP_IDENTITY_POOL_ID=<ReactAppIdentityPoolId>
      REACT_APP_CLOUDFRONT_DOMAIN_NAME=<ReactAppCloudfrontDomainName>
      REACT_APP_DOCUMENTS_KB_ID=<ReactAppDocumentsKbId>
      REACT_APP_DOCUMENTS_DS_ID=<ReactAppDocumentsDsId>
      `
3. Replace placeholder values with chatbot.yaml CloudFormation stack outputs
4. Build and Deploy Frontend
      `
      #### Install dependencies
      npm install

      #### Build the application
      npm run build
      `
5. Upload the contents of chatbot-react/build to <ReactAppHostBucket> Amazon S3 bucket


## Usage
### Initial Setup
1. Verify the CloudFront distribution is deployed and active

### Application Access
1. Access the application using: https://<ReactAppCloudFrontDomainName>.cloudfront.net/
2. Signup or Log in with your credentials
3. Use the left navigation pane to:
   a. Upload files
   b. Initiate data sync
   c. Monitor sync status
4. Once sync is complete, start chatting with your data

### Test Guardrails
1. Create Guardrails from the Amazon Bedrock Console or obtain existing Guardrail ID and version
2. Use the left navigation pane to select 'Guardrails' from the dropdown
3. Provide the Guardrail ID and version 
4. Ask a question and test for blocked content

### Test different LLMs or Inference Configuration
1. Use the left navigation pane to select 'Inference Configuration' from the dropdown
2. Provide a Bedrock supported model's inference profile ID
3. Change Temperature and TopP
4. Ask a question and test infered answer

## Data Upload Options
1. Direct S3 Upload : Place files in the <ReactAppS3Source> bucket (Optional)
2. Web Interface : Upload through the application's UI

## Considerations
* Keep .env file secure and never commit it to version control
* Do not use sensitive, confidential, or critical data
* Do not process personally identifiable information (PII)
* Use only public data for testing and demonstration purposes

## Monitoring
- CloudWatch Logs for Lambda functions and upload/sync failures
- EventBridge rules for tracking file processing

## Limitations
- Supports specific media file formats only (Refer Amazon Bedrock Data Automation documentation)
- Maximum file size limitations apply based on AWS service limits
- Single document cannot exceed 20 pages
- Files have to be manually deleted from <ReactAppS3Source> and <OrganizedBucket> buckets and Amazon Bedrock Knowledge Basess have to be manually synced to reflect these changes.

## Region Support
Bedrock Data Automation currently available only in:
- us-west-2

## This sample solution is intended to be used with public, non-sensitive data only
This is a demonstration/sample solution and is not intended for production use. Please note:
- Do not use sensitive, confidential, or critical data
- Do not process personally identifiable information (PII)
- Use only public data for testing and demonstration purposes
- This solution is provided for learning and evaluation purposes only

## Security

See [CONTRIBUTING](CONTRIBUTING.md#security-issue-notifications) for more information.

## License

This library is licensed under the MIT-0 License. See the LICENSE file.

