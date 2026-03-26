package main

import (
	"net/http"

	"github.com/gin-gonic/gin"
)

func login(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{
		"token": "secret-token",
	})
}

func register(c *gin.Context) {
	c.JSON(http.StatusCreated, gin.H{
		"message": "registered",
	})
}
