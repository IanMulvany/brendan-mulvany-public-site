#!/bin/bash
# Simple deployment script for Vercel

echo "=========================================="
echo "Deploying Brendan Mulvany Photo Archive"
echo "=========================================="
echo ""

# Step 1: Build the static site
echo "📦 Building static site..."
python3 build_static.py --db public_site.db --config config.yaml --output dist

if [ $? -ne 0 ]; then
    echo "❌ Build failed. Please check the errors above."
    exit 1
fi

echo "✅ Build completed successfully!"
echo ""

# Step 2: Check if dist folder exists
if [ ! -d "dist" ]; then
    echo "❌ dist folder not found. Build may have failed."
    exit 1
fi

echo "📊 Build stats:"
echo "  - HTML files: $(find dist -name "*.html" | wc -l)"
echo "  - Total files: $(find dist -type f | wc -l)"
echo ""

# Step 3: Deploy to Vercel
echo "🚀 Deploying to Vercel..."
echo ""
echo "Choose deployment type:"
echo "  1) Preview deployment (test)"
echo "  2) Production deployment"
echo ""
read -p "Enter choice (1 or 2): " choice

case $choice in
    1)
        echo "Deploying preview..."
        vercel
        ;;
    2)
        echo "Deploying to production..."
        vercel --prod
        ;;
    *)
        echo "Invalid choice. Deploying preview by default..."
        vercel
        ;;
esac

echo ""
echo "✅ Deployment complete!"
echo ""
echo "💡 Tips:"
echo "  - To update featured images: python3 featured_selector.py"
echo "  - To rebuild: python3 build_static.py"
echo "  - To deploy: ./deploy.sh"
