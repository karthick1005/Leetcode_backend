import { client } from './config/redis.js'

export const errorResponse = (code, message) => {
    return {
        status: "error",
        data: null,
        error: {
            code: code,
            message: message
        }
    }
}

export const successResponse = (data) => {
    return {
        status: "ok",
        data: data
    }
}

export const getFromRedis = (key) => {
    return new Promise((resolve, reject) => {
        client.get(key, (err, data) => {

            if (err) {
                reject(err);
            } else {
                resolve(data);
            }

        });
    })
}

export const setInRedis = (key, value, ttl) => {
    return new Promise((resolve, reject) => {
        if (ttl) {
            client.setex(key, ttl, value, (err) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(value);
                }
            });
        } else {
            client.set(key, value, (err) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(value);
                }
            });
        }
    })
}