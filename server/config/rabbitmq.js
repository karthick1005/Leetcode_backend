import * as amqp from 'amqp-connection-manager';
const QUEUE_NAME = 'judge'

const connection = amqp.connect(['amqp://rabbitmq:5672']);

connection.on('connect', function() {
    console.log('✅ RabbitMQ Connected');
});

connection.on('disconnect', function(err) {
    console.log('❌ RabbitMQ Disconnected:', err);
});

const channelWrapper = connection.createChannel({
    json: true,
    setup: function(channel) {
        // `channel` here is a regular amqplib `ConfirmChannel`.
        return channel.assertQueue(QUEUE_NAME, {durable: true});
    }
});

export const sendMessage = async (data) => {
    try {
        // Wait for channel to be ready
        await channelWrapper.waitForConnect();
        
        console.log(`📨 Sending message to queue '${QUEUE_NAME}':`, data.submissionId);
        
        // Send message to queue
        await channelWrapper.sendToQueue(QUEUE_NAME, data);
        
        console.log(`✅ Message sent successfully: ${data.submissionId}`);
        return true;
    } catch (error) {
        console.error(`❌ Failed to send message:`, error.message);
        throw error;
    }
};


