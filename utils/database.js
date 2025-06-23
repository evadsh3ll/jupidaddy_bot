import { MongoClient } from 'mongodb';

const MONGODB_URI = process.env.MONGODB_URI
const DB_NAME = process.env.DB_NAME

let client;
let db;

export async function connectToDatabase() {
    try {
        client = new MongoClient(MONGODB_URI);
        await client.connect();
        db = client.db(DB_NAME);
        console.log('✅ Connected to MongoDB database:', DB_NAME);
        return db;
    } catch (error) {
        console.error('❌ Failed to connect to MongoDB:', error);
        throw error;
    }
}

export async function saveWalletConnection(chatId, walletAddress, username, sessionId, phantomEncryptionPubKey) {
    try {
        const collection = db.collection('wallet_connections');
        const connectionData = {
            chatId: String(chatId),
            walletAddress,
            username,
            sessionId,
            phantomEncryptionPubKey,
            connectedAt: new Date(),
            lastActivity: new Date()
        };

        // Upsert - update if exists, insert if not
        await collection.updateOne(
            { chatId: String(chatId) },
            { $set: connectionData },
            { upsert: true }
        );

        console.log(`✅ Wallet connection saved for chat ${chatId}`);
        return true;
    } catch (error) {
        console.error('❌ Failed to save wallet connection:', error);
        return false;
    }
}

export async function saveRouteHistory(chatId, inputMint, outputMint, amount, routeDetails, username) {
    try {
        const collection = db.collection('route_history');
        const routeData = {
            chatId: String(chatId),
            username,
            inputMint,
            outputMint,
            amount,
            routeDetails,
            timestamp: new Date()
        };

        await collection.insertOne(routeData);
        console.log(`✅ Route history saved for chat ${chatId}`);
        return true;
    } catch (error) {
        console.error('❌ Failed to save route history:', error);
        return false;
    }
}

export async function saveTriggerHistory(chatId, inputMint, outputMint, amount, targetPrice, orderId, username) {
    try {
        const collection = db.collection('trigger_history');
        const triggerData = {
            chatId: String(chatId),
            username,
            inputMint,
            outputMint,
            amount,
            targetPrice,
            orderId,
            status: 'created',
            timestamp: new Date()
        };

        await collection.insertOne(triggerData);
        console.log(`✅ Trigger history saved for chat ${chatId}`);
        return true;
    } catch (error) {
        console.error('❌ Failed to save trigger history:', error);
        return false;
    }
}

export async function savePaymentHistory(chatId, amount, type, walletAddress, username) {
    try {
        const collection = db.collection('payment_history');
        const paymentData = {
            chatId: String(chatId),
            username,
            amount,
            type, // 'receive' or 'send'
            walletAddress,
            timestamp: new Date()
        };

        await collection.insertOne(paymentData);
        console.log(`✅ Payment history saved for chat ${chatId}`);
        return true;
    } catch (error) {
        console.error('❌ Failed to save payment history:', error);
        return false;
    }
}

export async function savePriceCheckHistory(chatId, token, price, username) {
    try {
        const collection = db.collection('price_check_history');
        const priceData = {
            chatId: String(chatId),
            username,
            token,
            price,
            timestamp: new Date()
        };

        await collection.insertOne(priceData);
        console.log(`✅ Price check history saved for chat ${chatId}`);
        return true;
    } catch (error) {
        console.error('❌ Failed to save price check history:', error);
        return false;
    }
}

export async function saveNotificationHistory(chatId, token, condition, targetPrice, username) {
    try {
        const collection = db.collection('notification_history');
        const notificationData = {
            chatId: String(chatId),
            username,
            token,
            condition,
            targetPrice,
            status: 'active',
            timestamp: new Date()
        };

        await collection.insertOne(notificationData);
        console.log(`✅ Notification history saved for chat ${chatId}`);
        return true;
    } catch (error) {
        console.error('❌ Failed to save notification history:', error);
        return false;
    }
}

export async function getHistory(chatId, type = 'all', limit = 10) {
    try {
        const collections = {
            'route': 'route_history',
            'trigger': 'trigger_history',
            'payment': 'payment_history',
            'price': 'price_check_history',
            'notification': 'notification_history',
            'all': null
        };

        if (type === 'all') {
            // Get recent activity from all collections
            const allHistory = [];
            
            for (const [key, collectionName] of Object.entries(collections)) {
                if (collectionName) {
                    const collection = db.collection(collectionName);
                    const history = await collection
                        .find({ chatId: String(chatId) })
                        .sort({ timestamp: -1 })
                        .limit(limit)
                        .toArray();
                    
                    history.forEach(item => {
                        item.type = key;
                        allHistory.push(item);
                    });
                }
            }

            // Sort by timestamp and limit
            allHistory.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
            return allHistory.slice(0, limit);
        } else {
            const collectionName = collections[type];
            if (!collectionName) {
                throw new Error('Invalid history type');
            }

            const collection = db.collection(collectionName);
            return await collection
                .find({ chatId: String(chatId) })
                .sort({ timestamp: -1 })
                .limit(limit)
                .toArray();
        }
    } catch (error) {
        console.error('❌ Failed to get history:', error);
        return [];
    }
}

export async function updateLastActivity(chatId) {
    try {
        const collection = db.collection('wallet_connections');
        await collection.updateOne(
            { chatId: String(chatId) },
            { $set: { lastActivity: new Date() } }
        );
    } catch (error) {
        console.error('❌ Failed to update last activity:', error);
    }
}

export async function closeDatabase() {
    if (client) {
        await client.close();
        console.log('✅ Database connection closed');
    }
} 