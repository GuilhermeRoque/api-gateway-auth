const fs = require('fs');

if(!process.env.ACCESS_TOKEN_SECRET){
    process.env.ACCESS_TOKEN_SECRET  = fs.readFileSync(process.env.ACCESS_SECRET, 'utf8')
}
if(!process.env.REFRESH_TOKEN_SECRET){
    process.env.REFRESH_TOKEN_SECRET  = fs.readFileSync(process.env.REFRESH_SECRET, 'utf8')
}

const {redisClient} = require("./redisClient");
const app = require('./app')

redisClient.connect()
    .then(app.listen(3000, () => {console.log('API Gateway running!')}))
    .catch("Couldn't start API-Gateway")


