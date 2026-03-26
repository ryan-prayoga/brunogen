package main

import (
	"net/http"

	"github.com/gin-gonic/gin"
)

func listReports(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{
		"data": []gin.H{
			{"id": 1, "name": "Monthly report"},
		},
	})
}
