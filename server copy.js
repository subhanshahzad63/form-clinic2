const express = require('express');
const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const bodyParser = require('body-parser');
const nodemailer = require('nodemailer'); // Add nodemailer
const app = express();

const PORT = process.env.PORT || 3000;

// Serve static files (HTML, CSS, etc.)
app.use(express.static('public'));
app.use('/assets', express.static(path.join(__dirname, 'assets')));
app.use(bodyParser.json());  // Add middleware to parse JSON request body

app.post('/download-pdf', async (req, res) => {
    try {
        const { applicantName, idNumber, phoneNumber, occupation, income, familyMembers, finalIncome, signatureDate, signature, email } = req.body;

        const outputDir = path.join(__dirname, 'output');
        if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir);
        }

        const images = ['1.png', '2.png', '3.png', '4.png', '5.png'];
        const selectedImage = images[Math.floor(Math.random() * images.length)];
        const imagePath = `http://localhost:${PORT}/assets/${selectedImage}`;

        const browser = await puppeteer.launch({
            headless: 'new',  // Using the newer headless mode for performance
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });
        const page = await browser.newPage();
        await page.goto(`http://localhost:${PORT}`, { waitUntil: 'networkidle0' });

        await page.evaluate((applicantName, idNumber, phoneNumber, occupation, income, familyMembers, finalIncome, signatureDate, signature, imagePath) => {
            document.querySelector('input[placeholder="Enter name"]').value = applicantName;
            document.querySelector('input[placeholder="Enter ID number"]').value = idNumber;
            document.querySelector('input[placeholder="Enter phone number"]').value = phoneNumber;
            document.querySelector('input[placeholder="Enter occupation"]').value = occupation;
            document.querySelector('input[placeholder="Amount"]').value = income;

            // Populate family members section
            familyMembers.forEach((familyMember, index) => {
                document.querySelectorAll('.family-name')[index].value = familyMember.name;
                document.querySelectorAll('.family-occupation')[index].value = familyMember.occupation;
                document.querySelectorAll('.family-income')[index].value = familyMember.income;
            });

            // Populate additional inputs
            document.querySelector('.final-income').value = finalIncome;
            document.querySelector('.signature-date').value = signatureDate;

            // Append the signature image to the correct container
            const signatureContainer = document.getElementById('signatureContainer');
            const signatureImage = document.createElement('img');
            signatureImage.src = signature;
            signatureImage.style.width = '150px';
            signatureImage.style.height = '50px';
            signatureContainer.innerHTML = '';  // Clear the canvas
            signatureContainer.appendChild(signatureImage);  // Add the image in the correct place

            // Set the hidden image and wait for it to load
            const imageElement = document.querySelector('.hidden-pdf-image');
            return new Promise((resolve, reject) => {
                if (imageElement) {
                    imageElement.src = imagePath;
                    imageElement.onload = resolve;
                    imageElement.onerror = reject;
                } else {
                    resolve();
                }
            });
        }, applicantName, idNumber, phoneNumber, occupation, income, familyMembers, finalIncome, signatureDate, signature, imagePath);


        // Generate the PDF after ensuring the signature is included
        const pdf = await page.pdf({
            format: 'A4',
            printBackground: true,
        });

        const pdfPath = path.join(__dirname, 'output', 'generated-document.pdf');
        fs.writeFileSync(pdfPath, pdf);

        await browser.close();

        // Send email with the generated PDF
        const transporter = nodemailer.createTransport({
            service: 'gmail', // You can use other email services like Outlook, Yahoo, etc.
            auth: {
                user: 'zafardeveloper8@gmail.com', // Replace with your email
                pass: 'nhgt tjjs pevp cufw', // Replace with your email password (or App Password if using 2FA)
            }
        });

        const mailOptions = {
            from: 'zafardeveloper8@gmail.com',
            to: 'zafardeveloper8@gmail.com', // User's email
            subject: 'Your PDF Document',
            text: 'Please find your generated PDF document attached.',
            attachments: [{
                filename: 'document.pdf',
                path: pdfPath
            }]
        };

        transporter.sendMail(mailOptions, (error, info) => {
            if (error) {
                console.error('Error sending email:', error);
                return res.status(500).send('Error sending email');
            }
            console.log('Email sent:', info.response);
            res.json({ message: 'PDF generated, saved, and emailed', link: '/download-server-pdf' });
        });
    } catch (error) {
        console.error('Error generating PDF:', error.message, error.stack);
        res.status(500).send('Error generating PDF');
    }
});

// // Route to serve the saved PDF for download
// app.get('/download-server-pdf', (req, res) => {
//     const filePath = path.join(__dirname, 'output', 'generated-document.pdf');
//     res.download(filePath, 'document.pdf', (err) => {
//         if (err) {
//             console.error('Error downloading PDF:', err);
//         }
//     });
// });

// Start the server
app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
