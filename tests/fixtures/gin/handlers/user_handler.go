package main

import (
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
)

func listUsers(c *gin.Context) {
	page := c.Query("page")
	pageInt, _ := strconv.Atoi(page)

	c.JSON(http.StatusOK, ListUsersResponse{
		Data: []UserResponse{{
			ID:    1,
			Name:  "Jane Doe",
			Email: "user@example.com",
		}},
		Page: pageInt,
	})
}

func createUser(c *gin.Context) {
	var req CreateUserRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if req.Email == "exists@example.com" {
		c.JSON(http.StatusConflict, gin.H{"error": "Email already exists"})
		return
	}

	c.JSON(http.StatusCreated, gin.H{
		"message": "user created",
		"data": UserResponse{
			ID:        1,
			Name:      req.Name,
			Email:     req.Email,
			Age:       req.Age,
			Role:      req.Role,
			CreatedAt: "2024-01-01T00:00:00Z",
		},
	})
}

func getUser(c *gin.Context) {
	id := c.Param("id")
	traceID := c.GetHeader("X-Trace-Id")

	if id == "404" {
		c.JSON(http.StatusNotFound, gin.H{"error": "User not found"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"data": UserResponse{
			ID:        1,
			Name:      "Jane Doe",
			Email:     traceID,
			CreatedAt: "2024-01-01T00:00:00Z",
		},
	})
}

func updateUser(c *gin.Context) {
	var req UpdateUserRequest
	if err := c.BindJSON(&req); err != nil {
		c.AbortWithStatusJSON(http.StatusUnprocessableEntity, gin.H{"errors": gin.H{"name": "required"}})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"message": "updated",
	})
}

func deleteUser(c *gin.Context) {
	c.Status(http.StatusNoContent)
}

func getMe(c *gin.Context) {
	token := c.GetHeader("Authorization")

	c.JSON(http.StatusOK, gin.H{
		"data": gin.H{
			"token": token,
		},
	})
}
