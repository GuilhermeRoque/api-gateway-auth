const { createProxyMiddleware, responseInterceptor } = require('http-proxy-middleware');
const express = require('express');
const app = express();
var logger = require('morgan');
const {redisClient} = require("./redisClient");
const { UnauthorizedError } = require('web-service-utils/serviceErrors');
const util = require('util')
const jwt = require('jsonwebtoken')
app.use(logger('dev'));
const verifyAsync = util.promisify(jwt.verify)


// async function removeAccessToken(accessToken){
//     if(accessToken){
//         try {
//             await verifyAsync(accessToken, process.env.ACCESS_TOKEN_SECRET)        
//             await redisClient.pushDenyListJWT(accessToken)
//         } catch (error) {console.log("Error! accessToken will not be added to deny list", accessToken)}
//     }
// }

// async function removeRefreshToken(refreshToken){
//     if(refreshToken){
//         try {
//             await verifyAsync(refreshToken, process.env.REFRESH_TOKEN_SECRET,)        
//             await redisClient.pushDenyListJWT(refreshToken)
//         } catch (error) {console.log("Error! refreshToken will not be added to deny list", refreshToken)}
//     }
// }

// async function signout(accessToken, refreshToken){
//     removeAccessToken(accessToken)
//     removeRefreshToken(refreshToken)
// }
// async function refresh(userId){
//     console.log("refresh", refreshToken)
//     const denyToken = await redisClient.isInDenyListJWT(refreshToken)
//     if (denyToken) throw new UnauthorizedError("Token is in deny list", {token: refreshToken})
    
//     let userId = undefined
//     try {
//         const payload = await verifyAsync(refreshToken, process.env.REFRESH_TOKEN_SECRET)            
//         userId = payload.userId
//     } catch (error) {
//         throw new UnauthorizedError("Token is invalid", {token: refreshToken})  
//     }    
// }




// check if token is in deny list -> check if token is valid -> check if user is in deny list
async function verify(accessToken){
    // console.log("VERIFYING TOKEN: ", accessToken)
    if (!accessToken) throw new UnauthorizedError("Access token missing")
    const isInDenyListJWT = await redisClient.isInDenyListJWT(accessToken)
    if (isInDenyListJWT) throw new UnauthorizedError("Access token is in deny list", {accessToken: accessToken})

    let user = undefined
    try {
        const payload = await verifyAsync(accessToken, process.env.ACCESS_TOKEN_SECRET)
        // console.log("PAYLOAD: ", payload)
        user = payload.user
    } catch (error) {
        throw new UnauthorizedError("Access token is invalid", {accessToken: accessToken})        
    }
    const userId = user._id
    const isInDenyUserList = await redisClient.isInDenyListUserId(userId)
    if (isInDenyUserList) throw new UnauthorizedError("User is in deny list", {accessToken: accessToken, user: user})
    return {user: user, accessToken: accessToken}

}

const verifyAccessToken = (async (req, res, next) => {
    try {
        const accessToken = _getToken(req)
        const userToken = await verify(accessToken)
        console.log("userToken", userToken)
        req.user = userToken.user
        req.accessToken = userToken.accessToken
        next()                
    } catch (error) {
        next(error)
    }
})

app.put("/users*", verifyAccessToken)
app.delete("/users*", verifyAccessToken)
app.get("/users*", verifyAccessToken)
app.use('/users', createProxyMiddleware({target: process.env.IDENTITY_SERVICE}))

// app.use('/auth', createProxyMiddleware({target: URL}))

// function onProxyRes(proxyRes, req, res) {
//     console.log("proxyRes", proxyRes)
//     console.log('\n\ndeny jwt\n\n')
// }
// app.use("/organizations/:id/members", createProxyMiddleware({target: URL, changeOrigin:true, onProxyRes:onProxyRes}))

redisClient.connect()
    .then(app.listen(3000, () => {console.log('API Gateway running!')}))
    .catch("Couldn't start API-Gateway")
