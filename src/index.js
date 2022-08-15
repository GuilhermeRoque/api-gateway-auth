const app = require('./app')
const {redisClient} = require("./redisClient");


redisClient.connect()
    .then(app.listen(3000, () => {console.log('API Gateway running!')}))
    .catch("Couldn't start API-Gateway")


