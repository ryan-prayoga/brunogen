package main

import (
	"net/http"

	"github.com/gin-gonic/gin"
)

type CreateReportRequest struct {
	ID       string `json:"id" binding:"required,uuid"`
	Code     string `json:"code" validate:"required,len=6"`
	Score    int    `json:"score" binding:"gte=1,lte=100"`
	Priority int    `json:"priority" validate:"gt=0,lt=5"`
}

func main() {
	router := gin.Default()
	router.POST("/api/reports", CreateReport)
}

func CreateReport(c *gin.Context) {
	var req CreateReportRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusCreated, gin.H{"data": req})
}
