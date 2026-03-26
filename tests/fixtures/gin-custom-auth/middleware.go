package main

import "github.com/gin-gonic/gin"

func CheckPermission() gin.HandlerFunc {
	return func(c *gin.Context) {
		c.Next()
	}
}
