const express = require('express');
const multer = require('multer');
const { removeBackground } = require('@imgly/background-removal-node');
const path = require('path');
const fs = require('fs');

// Increase Node.js memory limit
const v8 = require('v8');
v8.setFlagsFromString('--max-old-space-size=512'); // Set to 512MB

const app = express();
const port = process.env.PORT || 3000;

// Configure multer for file upload with size limits
const upload = multer({
    dest: 'uploads/',
    limits: {
        fileSize: 5 * 1024 * 1024, // 5MB limit
    }
});

// Serve static files from 'public' directory
app.use(express.static('public'));

// Serve the main HTML page
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Handle file upload and background removal
app.post('/remove-background', upload.single('image'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded' });
        }

        // Check file size
        const stats = fs.statSync(req.file.path);
        if (stats.size > 5 * 1024 * 1024) { // 5MB
            fs.unlinkSync(req.file.path);
            return res.status(400).json({ error: 'File size too large. Maximum size is 5MB.' });
        }

        // Check file type
        const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];
        if (!allowedTypes.includes(req.file.mimetype)) {
            fs.unlinkSync(req.file.path);
            return res.status(400).json({ error: 'Invalid file type. Only JPEG, PNG, and WebP are allowed.' });
        }

        try {
            // Remove background with timeout
            const blob = await Promise.race([
                removeBackground(req.file.path),
                new Promise((_, reject) => 
                    setTimeout(() => reject(new Error('Processing timeout')), 30000)
                )
            ]);
            
            const buffer = Buffer.from(await blob.arrayBuffer());
            
            // Generate output filename
            const outputFilename = `output_${Date.now()}.png`;
            const outputPath = path.join(__dirname, 'public', 'outputs', outputFilename);
            
            // Ensure outputs directory exists
            if (!fs.existsSync(path.join(__dirname, 'public', 'outputs'))) {
                fs.mkdirSync(path.join(__dirname, 'public', 'outputs'), { recursive: true });
            }

            // Save the processed image
            fs.writeFileSync(outputPath, buffer);

            // Get file size
            const outputStats = fs.statSync(outputPath);
            const fileSize = outputStats.size;

            // Clean up uploaded file
            fs.unlinkSync(req.file.path);

            // Send response with the path to the processed image
            res.json({ 
                success: true, 
                outputPath: `/outputs/${outputFilename}`,
                fileSize: fileSize
            });
        } catch (processError) {
            // Clean up on processing error
            if (fs.existsSync(req.file.path)) {
                fs.unlinkSync(req.file.path);
            }
            throw processError;
        }
    } catch (error) {
        console.error('Error:', error);
        if (error.message === 'Processing timeout') {
            res.status(408).json({ error: 'Image processing took too long. Please try a smaller image.' });
        } else if (error.message.includes('memory')) {
            res.status(413).json({ error: 'Image too large to process. Please try a smaller image.' });
        } else {
            res.status(500).json({ error: 'Error processing image. Please try again.' });
        }
    }
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error('Unhandled error:', err);
    res.status(500).json({ error: 'Internal server error' });
});

// Start the server
app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});