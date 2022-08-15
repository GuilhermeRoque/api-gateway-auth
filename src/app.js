const { createProxyMiddleware } = require('http-proxy-middleware');
const express = require('express');
const app = express();
const api_gateway = require('./api-gateway')
var logger = require('morgan');
const { ServiceError } = require('web-service-utils/serviceErrors');
const { HttpStatusCodes } = require('web-service-utils/enums');
const cookieParser = require('cookie-parser');

app.use(logger('dev'));
app.use(cookieParser())

app.use('/api', api_gateway)

// PROXY FRONT END SERVER AND SET FRONT END TO REQUEST TO API_GATEWAY TO AVOID CORS
app.get('/*',createProxyMiddleware({target: process.env.FRONT_END}))

// HANDLE ERRORS
app.use(async (error, req, res, next) =>{
    console.log("Handling error...")
    console.log(error)
    if (error instanceof ServiceError){
        res.status(error.httpStatusCode).send({
            message: error.message, 
            value: error.value
        })    
    }else{
        const message = 'Unexpected error'
        console.log(message)
        res.status(HttpStatusCodes.INTERNAL_SERVER).send({
            message: message, 
        })    
    }
})

module.exports = app